'use strict';
// API-Football v3 (api-sports.io). Auth: x-apisports-key header. The free plan allows 100 requests/day, so this client
// tracks the quota from the response headers and the caller falls back to ESPN when it runs low or access is refused.
const { abbrFor } = require('./teams');

const BASE = 'https://v3.football.api-sports.io';
const IDS = { 'eng.1': 39, 'esp.1': 140, 'ita.1': 135, 'ger.1': 78, 'fra.1': 61, 'uefa.champions': 2, 'uefa.europa': 3, 'usa.1': 253, 'sau.1': 307 };
const RESERVE = 12; // keep a few requests in hand for the app's own next-match checks
const DAY = 86400000;

class AFError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

// European competitions run Aug to May, so the "season" is the year it started. MLS runs within a calendar year.
function seasonFor(league, now) {
  const d = new Date(now);
  if (league === 'usa.1') return d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

function statusOf(st = {}) {
  const s = st.short || '';
  if (['1H', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE'].includes(s)) {
    const extra = st.extra ? `+${st.extra}` : '';
    return { state: 'in', label: s === 'P' ? 'PEN' : st.elapsed != null ? `${st.elapsed}${extra}'` : 'LIVE' };
  }
  if (s === 'HT') return { state: 'in', label: 'HT' };
  if (['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(s)) return { state: 'post', label: s === 'FT' ? 'FT' : s === 'AWD' || s === 'WO' ? 'FT' : s };
  if (['PST', 'CANC', 'ABD', 'SUSP'].includes(s)) return { state: 'off', label: s === 'PST' ? 'PP' : s === 'CANC' ? 'CANC' : 'OFF' };
  return { state: 'pre', label: '' };
}

function parseFixtures(json) {
  const out = [];
  for (const r of (json && json.response) || []) {
    const f = r.fixture || {}, t = r.teams || {}, g = r.goals || {};
    if (!t.home || !t.away) continue;
    const st = statusOf(f.status);
    const side = (x, score) => ({
      id: String(x.id), name: x.name, full: x.name, abbr: abbrFor(x.name), logo: x.logo || '',
      score: st.state === 'pre' || st.state === 'off' ? null : Number.isFinite(score) ? score : 0,
    });
    out.push({
      id: `af:${f.id}`, src: 'af', date: (f.timestamp || Date.parse(f.date) / 1000 || 0) * 1000,
      state: st.state, label: st.label, home: side(t.home, g.home), away: side(t.away, g.away), note: (f.status && f.status.long) || '',
    });
  }
  return out.sort((a, b) => a.date - b.date);
}

function parseStandings(json) {
  const lg = (((json || {}).response || [])[0] || {}).league || {};
  const groups = [];
  for (const grp of lg.standings || []) {
    const rows = (grp || []).map((s) => {
      const t = s.team || {}, a = s.all || {}, goals = a.goals || {};
      return {
        rank: s.rank, id: String(t.id), src: 'af', name: t.name, full: t.name, abbr: abbrFor(t.name), logo: t.logo || '',
        played: a.played || 0, w: a.win || 0, d: a.draw || 0, l: a.lose || 0, gf: goals.for || 0, ga: goals.against || 0,
        gd: s.goalsDiff != null ? s.goalsDiff : (goals.for || 0) - (goals.against || 0), pts: s.points || 0,
      };
    });
    if (rows.length) groups.push({ name: (lg.standings.length > 1 && grp[0] && grp[0].group) || '', rows });
  }
  return groups;
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

function createApiFootball({ fetchFn = globalThis.fetch, getKey = () => '', clock = Date.now } = {}) {
  const quota = { remaining: null, limit: null };
  let used = 0, usedDay = '';
  let blockedUntil = 0, blockedMsg = '', blockedKey = '';
  const planBlocked = new Map(); // league -> { until, msg }

  const keyNow = () => String(getKey() || '').trim();

  function countUse() {
    const day = ymd(clock());
    if (day !== usedDay) { usedDay = day; used = 0; }
    used++;
  }
  function readQuota(res) {
    const h = res && res.headers && typeof res.headers.get === 'function' ? res.headers : null;
    if (!h) return;
    const rem = parseInt(h.get('x-ratelimit-requests-remaining'), 10), lim = parseInt(h.get('x-ratelimit-requests-limit'), 10);
    if (Number.isFinite(rem)) quota.remaining = rem;
    if (Number.isFinite(lim)) quota.limit = lim;
  }

  async function call(path, params) {
    const key = keyNow();
    if (!key) throw new AFError('nokey', 'No API-Football key set');
    countUse();
    const res = await fetchFn(`${BASE}${path}?${new URLSearchParams(params)}`, {
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    readQuota(res);
    if (!res.ok) throw new AFError(res.status === 429 ? 'rate' : res.status === 403 || res.status === 401 ? 'token' : 'http', `API-Football answered ${res.status}`);
    const json = await res.json();
    const e = json && json.errors;
    const keys = e && !Array.isArray(e) ? Object.keys(e) : [];
    if (keys.length) {
      const k = keys[0];
      throw new AFError(k === 'token' ? 'token' : k === 'plan' ? 'plan' : k === 'requests' ? 'requests' : k === 'rateLimit' ? 'rate' : 'other', String(e[k]));
    }
    return json;
  }

  function usable(league) {
    const key = keyNow();
    if (!key || !IDS[league]) return false;
    if (blockedKey && blockedKey !== key) { blockedKey = ''; blockedUntil = 0; blockedMsg = ''; } // a new key clears a token block
    if (clock() < blockedUntil) return false;
    const pb = planBlocked.get(league);
    if (pb && clock() < pb.until) return false;
    if (quota.remaining != null && quota.remaining <= RESERVE) return false;
    if (quota.remaining == null && quota.limit == null && used >= 100 - RESERVE) return false;
    return true;
  }

  function noteError(err, league) {
    const k = err && err.kind;
    if (k === 'token') { blockedKey = keyNow(); blockedUntil = Infinity; blockedMsg = 'API-Football rejected the key'; }
    else if (k === 'plan') planBlocked.set(league, { until: clock() + 6 * 3600000, msg: err.message });
    else if (k === 'requests') { blockedUntil = Math.floor(clock() / DAY) * DAY + DAY; blockedMsg = 'Daily API-Football quota used up'; quota.remaining = 0; }
    else if (k === 'rate') { blockedUntil = clock() + 90000; blockedMsg = 'API-Football rate limit, retrying shortly'; }
    else if (k !== 'nokey') { blockedUntil = clock() + 120000; blockedMsg = err && err.message ? err.message : 'API-Football unreachable'; }
  }

  function status(league) {
    const pb = league && planBlocked.get(league);
    let note = '';
    if (!keyNow()) note = '';
    else if (pb && clock() < pb.until) note = pb.msg;
    else if (clock() < blockedUntil) note = blockedMsg;
    else if (quota.remaining != null && quota.remaining <= RESERVE) note = 'API-Football quota nearly used up for today';
    return { configured: !!keyNow(), remaining: quota.remaining, limit: quota.limit, note };
  }

  const fixtures = async (league) => {
    const season = seasonFor(league, clock());
    return parseFixtures(await call('/fixtures', { league: IDS[league], season, from: ymd(clock() - 3 * DAY), to: ymd(clock() + 7 * DAY) }));
  };
  const table = async (league) => parseStandings(await call('/standings', { league: IDS[league], season: seasonFor(league, clock()) }));

  return { usable, noteError, status, fixtures, table, call, quota: () => ({ ...quota }) };
}

module.exports = { createApiFootball, parseFixtures, parseStandings, seasonFor, statusOf, IDS, AFError, RESERVE };
