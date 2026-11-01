'use strict';
// OpenF1 (api.openf1.org): car positions, race control (flags / safety car), positions and gaps.
// Historical data is free. Live data during a session needs an OpenF1 account (OAuth2 password sign-in).
const BASE = 'https://api.openf1.org/v1';
const TOKEN_URL = 'https://api.openf1.org/token';

class OpenF1Error extends Error {
  constructor(kind, message, status, retryAfter) { super(message); this.kind = kind; this.status = status; this.retryAfter = retryAfter; }
}

// OpenF1 timestamps: "2026-11-01T14:03:35.200000+00:00" (or without a zone, meaning UTC)
const ts = (s) => {
  if (typeof s === 'number') return s;
  const t = String(s || '');
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
};
const iso = (ms) => new Date(ms).toISOString().slice(0, -1); // UTC, no zone: what the docs use in filters
// Filters like date>=... carry their operator in the key, so keys ending in an operator get no "=".
const qs = (pairs) => pairs.map(([k, v]) => `${k}${/[<>=]$/.test(k) ? '' : '='}${encodeURIComponent(v).replace(/%3A/gi, ':')}`).join('&');

// OpenF1 caps free keys at 3 requests a second and 30 a minute (double that for sponsors).
// Every call goes through here: requests are serialised and delayed rather than refused.
const FREE = { perSec: 3, perMin: 30 };
const SPONSOR = { perSec: 6, perMin: 60 };
function createLimiter({ perSec = FREE.perSec, perMin = FREE.perMin, clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let limits = { perSec, perMin };
  let hits = [];
  let chain = Promise.resolve();
  const trim = (now) => { hits = hits.filter((t) => now - t < 60000); };
  function waitFor() {
    const now = clock();
    trim(now);
    const sec = hits.filter((t) => now - t < 1000);
    if (sec.length >= limits.perSec) return 1000 - (now - sec[0]) + 20;
    if (hits.length >= limits.perMin) return 60000 - (now - hits[0]) + 20;
    return 0;
  }
  function run(fn) {
    const go = async () => {
      for (let d = waitFor(); d > 0; d = waitFor()) await sleep(d);
      hits.push(clock());
      return fn();
    };
    const p = chain.then(go, go);
    chain = p.then(() => {}, () => {});
    return p;
  }
  return {
    run,
    setLimits: (l) => { limits = { ...l }; },
    used: () => { trim(clock()); return { lastMinute: hits.length, perMin: limits.perMin }; },
  };
}

// OpenF1 treats a session as "live" from 30 min before the start until 30 min after the end;
// in that window the data needs a sponsor account. Outside it, everything is free.
const LIVE_PAD = 30 * 60000;
const isLiveWindow = (session, now) => !!session && now >= session.start - LIVE_PAD && now <= session.end + LIVE_PAD;

function createAuth({ fetchFn = globalThis.fetch, getCreds = () => null, clock = Date.now } = {}) {
  let token = null, exp = 0;
  async function login() {
    const c = getCreds();
    if (!c || !c.user || !c.pass) return null;
    const res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: c.user, password: c.pass }).toString() });
    let j = {};
    try { j = await res.json(); } catch { /* no body */ }
    if (!res.ok || !j.access_token) throw new OpenF1Error('auth', (j && (j.detail || j.error_description)) || `OpenF1 sign-in failed (${res.status})`, res.status);
    token = j.access_token; exp = clock() + (Number(j.expires_in) || 3600) * 1000;
    return token;
  }
  async function header() {
    const c = getCreds();
    if (!c || !c.user) return {};
    if (!token || clock() > exp - 60000) await login();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  return { login, header, signedIn: () => !!token, forget() { token = null; exp = 0; } };
}

const normSession = (s) => s && ({
  key: s.session_key, meeting: s.meeting_key, name: s.session_name, type: s.session_type, circuit: s.circuit_short_name || s.location || '',
  country: s.country_name || '', year: s.year, start: ts(s.date_start), end: ts(s.date_end),
});

// Raw car trace -> a clean, de-duplicated outline (about 1.5 m between points, at most ~500 points)
function cleanOutline(rows) {
  const pts = rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && !(r.x === 0 && r.y === 0)).sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) >= 15) out.push({ x: p.x, y: p.y }); }
  if (out.length > 500) { const step = out.length / 500; return Array.from({ length: 500 }, (_, i) => out[Math.floor(i * step)]); }
  return out;
}

function createOpenF1({ fetchFn = globalThis.fetch, auth = null, clock = Date.now, limiter = createLimiter() } = {}) {
  async function get(path, pairs) {
    const headers = { Accept: 'application/json', ...(auth ? await auth.header() : {}) };
    limiter.setLimits(auth && auth.signedIn() ? SPONSOR : FREE);
    const res = await limiter.run(() => fetchFn(`${BASE}${path}?${qs(pairs)}`, { headers, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }));
    if (res.status === 404) return [];                                  // "No results found"
    if (res.status === 429) throw new OpenF1Error('rate', 'OpenF1 is rate limiting', 429, Number(res.headers && res.headers.get && res.headers.get('retry-after')) || 5);
    if (res.status === 401 || res.status === 403) throw new OpenF1Error('auth', 'Live timing needs an OpenF1 sponsor account (\u20ac9.90/month). Replays and the demo are free.', res.status);
    if (!res.ok) throw new OpenF1Error('http', `OpenF1 answered ${res.status}`, res.status);
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  }

  const latestSession = async () => normSession((await get('/sessions', [['session_key', 'latest']]))[0]) || null;
  async function recentSessions(year) {
    return (await get('/sessions', [['year', year]])).map(normSession).filter((s) => s && Number.isFinite(s.start)).sort((a, b) => a.start - b.start);
  }

  function sourceFor(session) {
    const key = session.key;
    const rng = (from, to) => { const p = [['session_key', key]]; if (from != null) p.push(['date>=', iso(from)]); if (to != null) p.push(['date<', iso(to)]); return p; };
    return {
      session: async () => session,
      async drivers() {
        return (await get('/drivers', [['session_key', key]])).map((d) => ({
          n: d.driver_number, code: d.name_acronym || String(d.driver_number), name: d.full_name || d.broadcast_name || '', team: d.team_name || '',
          color: d.team_colour ? `#${String(d.team_colour).replace('#', '')}` : '#888888',
        }));
      },
      // One clean lap of a car's GPS trace = the circuit outline.
      // /laps with a lap number returns that lap for every driver, so this costs 2 requests, not one per driver.
      async outline(driverNumbers = []) {
        const want = new Set(driverNumbers);
        for (const lapNo of [3, 5, 2]) {
          const rows = (await get('/laps', [['session_key', key], ['lap_number', lapNo]]))
            .filter((l) => l.lap_duration > 0 && l.date_start && (!want.size || want.has(l.driver_number)))
            .sort((a, b) => a.lap_duration - b.lap_duration);           // the quickest lap is the cleanest trace
          for (const l of rows.slice(0, 2)) {
            const s = ts(l.date_start);
            const trace = await get('/location', [['session_key', key], ['driver_number', l.driver_number], ['date>=', iso(s)], ['date<', iso(s + l.lap_duration * 1000 + 500)]]);
            const o = cleanOutline(trace.map((r) => ({ x: r.x, y: r.y, t: ts(r.date) })));
            if (o.length > 40) return o;
          }
        }
        return null;
      },
      async location(from, to) { return (await get('/location', rng(from, to))).map((r) => ({ n: r.driver_number, x: r.x, y: r.y, t: ts(r.date) })).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.t)); },
      async raceControl(from, to) {
        return (await get('/race_control', rng(from, to))).map((r) => ({ t: ts(r.date), category: r.category, flag: r.flag, scope: r.scope, sector: r.sector, message: r.message, lap: r.lap_number }))
          .filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
      },
      async positions(from, to) { return (await get('/position', rng(from, to))).map((r) => ({ n: r.driver_number, pos: r.position, t: ts(r.date) })).filter((r) => Number.isFinite(r.t)); },
      async intervals(from, to) { return (await get('/intervals', rng(from, to))).map((r) => ({ n: r.driver_number, gap: r.gap_to_leader, int: r.interval, t: ts(r.date) })).filter((r) => Number.isFinite(r.t)); },
    };
  }
  return { get, latestSession, recentSessions, sourceFor, clock, limiter };
}

module.exports = { createOpenF1, createAuth, createLimiter, OpenF1Error, ts, iso, qs, cleanOutline, normSession, isLiveWindow, LIVE_PAD, FREE, SPONSOR, BASE, TOKEN_URL };
