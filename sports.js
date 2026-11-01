'use strict';
// Football (ESPN's public JSON, no key) and Formula 1 (Jolpica-F1 / Ergast-compatible, no key).
// Parsers are tolerant of missing fields; fetching/caching and the live-match watcher are injectable for tests.

const { createApiFootball } = require('./apifootball');
const { norm, teamMatches } = require('./teams');

const ESPN = 'https://site.api.espn.com/apis';
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

const LEAGUES = [
  { id: 'eng.1', name: 'Premier League', short: 'PL' },
  { id: 'esp.1', name: 'La Liga', short: 'La Liga' },
  { id: 'ita.1', name: 'Serie A', short: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga', short: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1', short: 'Ligue 1' },
  { id: 'uefa.champions', name: 'Champions League', short: 'UCL' },
  { id: 'uefa.europa', name: 'Europa League', short: 'UEL' },
  { id: 'usa.1', name: 'MLS', short: 'MLS' },
  { id: 'sau.1', name: 'Saudi Pro League', short: 'SPL' },
];
const isLeague = (id) => LEAGUES.some((l) => l.id === id);

/* ---------- fetching + cache ---------- */
async function getJson(url, fetchFn = globalThis.fetch) {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'Islet', Accept: 'application/json' },
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

function makeCache(clock = Date.now) {
  const store = new Map();
  const cached = async function cached(key, ttl, loader) {
    const e = store.get(key);
    if (e && e.ok && clock() - e.t < (typeof ttl === 'function' ? ttl(e.v) : ttl)) return e.v;
    if (e && e.p) return e.p; // a request for this key is already in flight
    const p = loader()
      .then((v) => { store.set(key, { ok: true, v, t: clock() }); return v; })
      .catch((err) => {
        const cur = store.get(key);
        if (cur && cur.ok) { // serve stale data, and retry in ~30 s rather than hammering a failing API
          store.set(key, { ok: true, v: cur.v, t: clock() - (typeof ttl === 'function' ? ttl(cur.v) : ttl) + 30000 });
          return cur.v;
        }
        store.delete(key);
        throw err;
      });
    store.set(key, { ...(e || {}), p });
    return p;
  };
  cached.clear = () => store.clear();
  return cached;
}

/* ================= football ================= */
function parseScoreboard(json) {
  const out = [];
  const seen = new Set();
  for (const ev of (json && json.events) || []) {
    const comp = (ev.competitions || [])[0];
    if (!comp || seen.has(ev.id)) continue;
    const side = (ha) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === ha);
      if (!c) return null;
      const t = c.team || {};
      const raw = c.score && typeof c.score === 'object' ? c.score.displayValue : c.score;
      const n = parseInt(raw, 10);
      return {
        id: String(t.id || ''), full: t.displayName || t.shortDisplayName || t.name || '?',
        name: t.shortDisplayName || t.displayName || t.name || '?',
        abbr: t.abbreviation || String(t.displayName || '?').slice(0, 3).toUpperCase(),
        logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || '',
        score: Number.isFinite(n) ? n : null,
      };
    };
    const home = side('home'), away = side('away');
    if (!home || !away) continue;
    seen.add(ev.id);
    const st = comp.status || ev.status || {};
    const type = st.type || {};
    const name = String(type.name || '');
    let state = ['pre', 'in', 'post'].includes(type.state) ? type.state : 'pre';
    let label = '';
    if (/POSTPONED|CANCEL|ABANDON/i.test(name)) { state = 'off'; label = 'PP'; }
    else if (state === 'in') label = /HALF/i.test(name) && !/FIRST|SECOND/i.test(name) ? 'HT' : st.displayClock || type.shortDetail || 'LIVE';
    else if (state === 'post') label = 'FT';
    out.push({
      id: String(ev.id), src: 'espn', date: Date.parse(ev.date || comp.date) || 0, state, label, home, away,
      note: type.detail || '',
    });
  }
  return out.sort((a, b) => a.date - b.date);
}

function parseStandings(json) {
  const children = (json && json.children) || (json && json.standings ? [json] : []);
  const groups = [];
  for (const ch of children) {
    const entries = (ch.standings && ch.standings.entries) || [];
    const rows = entries.map((e, i) => {
      const stats = {};
      for (const s of e.stats || []) {
        if (s.name !== undefined) stats[s.name] = s.value;
        if (s.abbreviation !== undefined && stats[s.abbreviation] === undefined) stats[s.abbreviation] = s.value;
      }
      const g = (...names) => { for (const n of names) if (stats[n] !== undefined && stats[n] !== null && stats[n] !== '') return Number(stats[n]); return 0; };
      const t = e.team || {};
      return {
        rank: g('rank', 'RK') || i + 1, id: String(t.id || ''), src: 'espn', full: t.displayName || t.shortDisplayName || '?', name: t.shortDisplayName || t.displayName || '?',
        abbr: t.abbreviation || '', logo: (t.logos && t.logos[0] && t.logos[0].href) || t.logo || '',
        played: g('gamesPlayed', 'GP'), w: g('wins', 'W'), d: g('ties', 'draws', 'D', 'T'), l: g('losses', 'L'),
        gf: g('pointsFor', 'F'), ga: g('pointsAgainst', 'A'), gd: g('pointDifferential', 'goalDifference', 'GD'), pts: g('points', 'PTS', 'P'),
      };
    }).sort((a, b) => a.rank - b.rank);
    if (rows.length) groups.push({ name: groups.length || children.length > 1 ? String(ch.name || '') : '', rows });
  }
  return groups;
}

const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

function createFootball({ fetchFn, clock = Date.now, getKey = () => '' } = {}) {
  const cached = makeCache(clock);
  const af = createApiFootball({ fetchFn, getKey, clock });
  const AF_FIXTURES = 5 * MIN, ESPN_FIXTURES = 45000, AF_TABLE = 3 * HOUR, ESPN_TABLE = 30 * MIN;

  // ESPN's scoreboard takes ?dates=YYYYMMDD. A YYYYMMDD-YYYYMMDD range works for some leagues/sports but is refused with a 400 for others,
  // so try the range once and, if ESPN rejects it, fetch the days one by one (and remember not to ask for the range again).
  let espnRangeRefused = false;
  const espnFixtures = async (league) => {
    const base = `${ESPN}/site/v2/sports/soccer/${league}/scoreboard`;
    if (!espnRangeRefused) {
      try { return parseScoreboard(await getJson(`${base}?dates=${ymd(clock() - 3 * DAY)}-${ymd(clock() + 7 * DAY)}`, fetchFn)); } catch (e) {
        if (!/answered 4\d\d/.test(e.message)) throw e; // network trouble is not a reason to change strategy
        espnRangeRefused = true;
      }
    }
    const days = [];
    for (let d = -2; d <= 6; d++) days.push(ymd(clock() + d * DAY));
    const res = await Promise.allSettled(days.map((d) => getJson(`${base}?dates=${d}`, fetchFn)));
    const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) throw res[0].reason;
    const seen = new Set(), events = [];
    for (const j of ok) for (const ev of (j && j.events) || []) if (!seen.has(ev.id)) { seen.add(ev.id); events.push(ev); }
    return parseScoreboard({ events });
  };
  const espnTable = async (league) => parseStandings(await getJson(`${ESPN}/v2/sports/soccer/${league}/standings`, fetchFn));

  // API-Football first (when a key is set and quota/plan allow), ESPN otherwise
  async function pick(league, afFn, espnFn) {
    if (af.usable(league)) {
      try { return { items: await afFn(league), src: 'af' }; } catch (e) { af.noteError(e, league); }
    }
    return { items: await espnFn(league), src: 'espn' };
  }
  const fixtures = (league, { maxAge } = {}) => cached(`fx:${league}`,
    (v) => (maxAge != null ? maxAge : v.src === 'af' ? AF_FIXTURES : ESPN_FIXTURES), () => pick(league, af.fixtures, espnFixtures));
  const table = (league) => cached(`tb:${league}`, (v) => (v.src === 'af' ? AF_TABLE : ESPN_TABLE), () => pick(league, af.table, espnTable));

  async function bundle(league) {
    if (!isLeague(league)) throw new Error('Unknown league');
    const [f, t] = await Promise.allSettled([fixtures(league), table(league)]);
    if (f.status === 'rejected' && t.status === 'rejected') throw f.reason;
    const src = (f.status === 'fulfilled' ? f.value : t.value).src;
    return {
      league, updated: clock(), src, source: src === 'af' ? 'API-Football' : 'ESPN', quota: af.status(league),
      fixtures: f.status === 'fulfilled' ? f.value.items : [], table: t.status === 'fulfilled' ? t.value.items : [],
      error: [f, t].filter((x) => x.status === 'rejected').map((x) => x.reason.message).join('; '),
    };
  }
  // poll gently on a metered key, freely on ESPN
  const liveInterval = (src) => {
    if (src !== 'af') return 45000;
    const r = af.quota().remaining;
    return r == null || r > 80 ? 60000 : r > 40 ? 90000 : 150000;
  };
  return { fixtures, table, bundle, liveInterval, af, clear: () => cached.clear() };
}

/* ================= Formula 1 ================= */
const SESSIONS = [
  ['FirstPractice', 'FP1'], ['SecondPractice', 'FP2'], ['ThirdPractice', 'FP3'],
  ['SprintQualifying', 'Sprint Qualifying'], ['SprintShootout', 'Sprint Qualifying'], ['Sprint', 'Sprint'], ['Qualifying', 'Qualifying'],
];
function stamp(d) {
  if (!d || !d.date) return null;
  let t = d.time || '00:00:00Z';
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) t += 'Z';
  const ms = Date.parse(`${d.date}T${t}`);
  return Number.isFinite(ms) ? ms : null;
}

function parseSchedule(json) {
  const races = (((json || {}).MRData || {}).RaceTable || {}).Races || [];
  return races.map((r) => {
    const sessions = [];
    for (const [key, label] of SESSIONS) {
      const start = stamp(r[key]);
      if (start) sessions.push({ key, label, start });
    }
    const start = stamp(r);
    if (start) sessions.push({ key: 'Race', label: 'Race', start });
    sessions.sort((a, b) => a.start - b.start);
    const loc = (r.Circuit && r.Circuit.Location) || {};
    return {
      round: +r.round, name: r.raceName, circuit: (r.Circuit && r.Circuit.circuitName) || '',
      locality: loc.locality || '', country: loc.country || '', start, sprint: sessions.some((s) => s.key === 'Sprint'), sessions,
    };
  });
}

function parseDriverStandings(json) {
  const list = ((((json || {}).MRData || {}).StandingsTable || {}).StandingsLists || [])[0] || {};
  return {
    season: list.season || '', round: +list.round || 0,
    rows: (list.DriverStandings || []).map((s) => {
      const d = s.Driver || {};
      const teams = s.Constructors || [];
      return {
        pos: +s.position, code: d.code || String(d.familyName || '?').slice(0, 3).toUpperCase(), number: d.permanentNumber || '',
        name: `${d.givenName || ''} ${d.familyName || ''}`.trim(), team: (teams[teams.length - 1] || {}).name || '',
        points: +s.points, wins: +s.wins,
      };
    }),
  };
}

function parseConstructorStandings(json) {
  const list = ((((json || {}).MRData || {}).StandingsTable || {}).StandingsLists || [])[0] || {};
  return {
    season: list.season || '', round: +list.round || 0,
    rows: (list.ConstructorStandings || []).map((s) => ({
      pos: +s.position, name: (s.Constructor || {}).name || '', points: +s.points, wins: +s.wins,
    })),
  };
}

function parseLastResult(json) {
  const race = ((((json || {}).MRData || {}).RaceTable || {}).Races || [])[0];
  if (!race) return null;
  return {
    name: race.raceName, round: +race.round, date: stamp(race), circuit: (race.Circuit && race.Circuit.circuitName) || '',
    results: (race.Results || []).map((r) => {
      const d = r.Driver || {};
      return {
        pos: r.positionText || r.position, code: d.code || String(d.familyName || '?').slice(0, 3).toUpperCase(),
        name: `${d.givenName || ''} ${d.familyName || ''}`.trim(), team: (r.Constructor || {}).name || '',
        grid: +r.grid, laps: +r.laps, status: r.status || '', time: (r.Time && r.Time.time) || '',
        points: +r.points, fastest: !!(r.FastestLap && String(r.FastestLap.rank) === '1'),
      };
    }),
  };
}

const nextRace = (races, now) => (races || []).find((r) => (r.start || 0) + 3 * HOUR > now) || null;
function nextSession(races, now) {
  for (const r of races || []) for (const s of r.sessions) if (s.start > now) return { race: r, session: s };
  return null;
}

function createF1({ fetchFn, clock = Date.now } = {}) {
  const cached = makeCache(clock);
  const j = (p) => getJson(`${JOLPICA}/${p}`, fetchFn);
  const schedule = () => cached('f1:sched', 6 * HOUR, async () => parseSchedule(await j('current.json?limit=60')));
  const drivers = () => cached('f1:drv', 20 * MIN, async () => parseDriverStandings(await j('current/driverStandings.json')));
  const teams = () => cached('f1:con', 20 * MIN, async () => parseConstructorStandings(await j('current/constructorStandings.json')));
  const last = () => cached('f1:last', 20 * MIN, async () => parseLastResult(await j('current/last/results.json')));
  async function bundle() {
    const names = ['schedule', 'drivers', 'teams', 'last'];
    const res = await Promise.allSettled([schedule(), drivers(), teams(), last()]);
    if (res.every((r) => r.status === 'rejected')) throw res[0].reason;
    const v = (i, d) => (res[i].status === 'fulfilled' ? res[i].value : d);
    return {
      updated: clock(), races: v(0, []), drivers: v(1, { rows: [] }), teams: v(2, { rows: [] }), last: v(3, null),
      error: res.map((r, i) => (r.status === 'rejected' ? `${names[i]}: ${r.reason.message}` : '')).filter(Boolean).join('; '),
    };
  }
  return { schedule, drivers, teams, last, bundle };
}

/* ================= alerts: favourite team + F1 sessions ================= */
class LiveWatcher {
  constructor({ football, getSettings, notify, onLive, onSummary, clock = Date.now }) {
    Object.assign(this, { football, getSettings, notify, onLive, onSummary, clock });
    this.prev = new Map();
    this.nextPoll = 0;
    this.liveNow = false;
    this.gen = 0;
  }
  reset() { this.prev.clear(); this.nextPoll = 0; this.gen++; } // also invalidates any check already in flight

  async tick(force = false) {
    const s = this.getSettings();
    const favs = (s.favTeams || []).filter((f) => f && f.league);
    if (!favs.length) { this.onLive(null); this.onSummary(null); return; }
    if (!force && this.clock() < this.nextPoll) return;

    const gen = this.gen;
    const found = [];
    let ok = false, src = '';
    for (const league of [...new Set(favs.map((f) => f.league))]) {
      try {
        const r = await this.football.fixtures(league, this.liveNow ? { maxAge: 55000 } : undefined);
        ok = true; src = r.src;
        for (const m of r.items) {
          const fav = favs.find((f) => f.league === league && (teamMatches(f, m.home, m.src) || teamMatches(f, m.away, m.src)));
          if (fav) found.push({ m, fav });
        }
      } catch { /* try again on the next tick */ }
    }
    if (gen !== this.gen) return; // the followed teams changed while we were fetching; that check is stale
    if (!ok) { this.nextPoll = this.clock() + 2 * MIN; return; }

    for (const x of found) this._diff(x.m, x.fav, s);
    const now = this.clock();
    const side = ({ m, fav }) => ({ ...m, favSide: teamMatches(fav, m.home, m.src) ? 'home' : 'away' });
    const live = found.find((x) => x.m.state === 'in');
    const upcoming = found.filter((x) => x.m.state === 'pre' && x.m.date > now - 3 * HOUR).sort((a, b) => a.m.date - b.m.date)[0];
    const recent = found.filter((x) => x.m.state === 'post').sort((a, b) => b.m.date - a.m.date)[0];
    this.liveNow = !!live;
    this.onLive(live ? side(live) : null);
    const show = live || upcoming || (recent && now - recent.m.date < 8 * HOUR ? recent : null);
    this.onSummary(show ? side(show) : null);

    let wait = 60 * MIN; // nothing close: look again in an hour (keeps a free API key well inside its daily quota)
    if (live) wait = this.football.liveInterval ? this.football.liveInterval(src) : 45000;
    else if (upcoming) wait = Math.min(60 * MIN, Math.max(upcoming.m.date - 16 * MIN - now, 2 * MIN));
    this.nextPoll = now + wait;
  }

  _diff(m, fav, s) {
    const on = s.footballAlerts !== false;
    const favHome = teamMatches(fav, m.home, m.src);
    const me = favHome ? m.home : m.away, opp = favHome ? m.away : m.home;
    const scoreLine = `${m.home.name} ${m.home.score ?? 0}–${m.away.score ?? 0} ${m.away.name}`;
    const key = `${norm(m.home.full || m.home.name)}|${norm(m.away.full || m.away.name)}|${new Date(m.date).toISOString().slice(0, 10)}`;
    const p = this.prev.get(key);
    const cur = { state: m.state, hs: m.home.score ?? 0, as: m.away.score ?? 0, ht: m.label === 'HT', reminded: p ? p.reminded : false };
    const send = (icon, title, body, duration = 6000) => { if (on) this.notify({ icon, title, body, duration }); };

    if (m.state === 'pre' && !cur.reminded) {
      const mins = (m.date - this.clock()) / MIN;
      if (mins <= 15 && mins > 0) { cur.reminded = true; send('⚽', `Kick-off in ${Math.ceil(mins)} min`, `${me.name} vs ${opp.name}`, 7000); }
    }
    if (p) {
      if (p.state === 'pre' && m.state === 'in') send('⚽', 'Kick-off!', `${me.name} vs ${opp.name}`, 5000);
      if (m.state === 'in' || m.state === 'post') {
        const dh = cur.hs - p.hs, da = cur.as - p.as;
        if (dh > 0 || da > 0) {
          const favScored = (favHome && dh > 0) || (!favHome && da > 0);
          send('⚽', favScored ? `GOAL! ${me.name}` : `Goal for ${opp.name}`, `${scoreLine}${m.state === 'in' && m.label ? ` · ${m.label}` : ''}`, 7000);
        } else if (dh < 0 || da < 0) {
          send('🚫', 'Goal disallowed', scoreLine, 6000);
        }
      }
      if (m.state === 'in' && cur.ht && !p.ht) send('⏸️', 'Half-time', scoreLine, 5000);
      if (p.state === 'in' && m.state === 'post') {
        const mineScore = favHome ? cur.hs : cur.as, theirs = favHome ? cur.as : cur.hs;
        send(mineScore > theirs ? '🎉' : mineScore < theirs ? '😞' : '🤝', 'Full-time', scoreLine, 7000);
      }
    }
    this.prev.set(key, cur);
  }
}

// Followed drivers' / constructor's championship position, from the standings already fetched.
function f1Favourites(drivers, teams, favDrivers, favConstructor) {
  const rows = (drivers && drivers.rows) || [];
  const out = { drivers: [], team: null };
  for (const code of favDrivers || []) {
    const r = rows.find((x) => x.code === code);
    if (r) out.drivers.push({ code: r.code, name: r.name, pos: r.pos, points: r.points, team: r.team });
  }
  const t = ((teams && teams.rows) || []).find((x) => favConstructor && norm(x.name) === norm(favConstructor));
  if (t) out.team = { name: t.name, pos: t.pos, points: t.points };
  return out;
}

class F1Reminders {
  constructor({ notify, clock = Date.now }) { this.notify = notify; this.clock = clock; this.sent = new Set(); }
  check(races, enabled) {
    if (!enabled || !races) return;
    const now = this.clock();
    for (const r of races) for (const s of r.sessions) {
      const d = s.start - now;
      const k15 = `${r.round}:${s.key}:15`, kgo = `${r.round}:${s.key}:go`;
      if (d <= 15 * MIN && d > MIN && !this.sent.has(k15)) {
        this.sent.add(k15);
        this.notify({ icon: '🏎️', title: `${s.label} in ${Math.round(d / MIN)} min`, body: r.name, duration: 7000 });
      }
      if (d <= 30000 && d > -90000 && !this.sent.has(kgo)) {
        this.sent.add(kgo);
        this.notify({ icon: '🚦', title: `${s.label} is starting`, body: r.name, duration: 6000 });
      }
    }
  }
}

module.exports = {
  LEAGUES, isLeague, getJson, makeCache, parseScoreboard, parseStandings, createFootball,
  parseSchedule, parseDriverStandings, parseConstructorStandings, parseLastResult, nextRace, nextSession, createF1,
  LiveWatcher, F1Reminders, f1Favourites,
};
