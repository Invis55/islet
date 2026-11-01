process.env.TZ = 'Asia/Karachi';
const assert = require('assert');
const AF = require('../apifootball');
const S = require('../sports');

/* ---------- pure parts ---------- */
const at = (y, m, d) => Date.UTC(y, m - 1, d, 12);
assert.strictEqual(AF.seasonFor('eng.1', at(2026, 11, 1)), 2026);
assert.strictEqual(AF.seasonFor('eng.1', at(2027, 3, 1)), 2026);
assert.strictEqual(AF.seasonFor('eng.1', at(2026, 6, 15)), 2025);
assert.strictEqual(AF.seasonFor('eng.1', at(2026, 7, 15)), 2026);
assert.strictEqual(AF.seasonFor('usa.1', at(2026, 11, 1)), 2026);
assert.strictEqual(AF.seasonFor('usa.1', at(2027, 2, 1)), 2027);

assert.deepStrictEqual(AF.statusOf({ short: 'NS' }), { state: 'pre', label: '' });
assert.deepStrictEqual(AF.statusOf({ short: '1H', elapsed: 34 }), { state: 'in', label: "34'" });
assert.deepStrictEqual(AF.statusOf({ short: '2H', elapsed: 90, extra: 3 }), { state: 'in', label: "90+3'" });
assert.deepStrictEqual(AF.statusOf({ short: 'HT', elapsed: 45 }), { state: 'in', label: 'HT' });
assert.deepStrictEqual(AF.statusOf({ short: 'FT' }), { state: 'post', label: 'FT' });
assert.deepStrictEqual(AF.statusOf({ short: 'PEN' }), { state: 'post', label: 'PEN' });
assert.deepStrictEqual(AF.statusOf({ short: 'PST' }), { state: 'off', label: 'PP' });

const fx = (id, ts, short, elapsed, h, a, hg, ag) => ({
  fixture: { id, timestamp: ts, date: new Date(ts * 1000).toISOString(), status: { short, long: short, elapsed } },
  league: { id: 39 }, teams: { home: { id: h[0], name: h[1], logo: `${h[0]}.png` }, away: { id: a[0], name: a[1], logo: `${a[0]}.png` } }, goals: { home: hg, away: ag },
});
const NOW = Date.parse('2026-11-01T07:00:00Z');
const fixturesJson = { get: 'fixtures', errors: [], results: 4, response: [
  fx(3, NOW / 1000 + 86400, 'NS', null, [49, 'Chelsea'], [50, 'Manchester City'], null, null),
  fx(1, NOW / 1000 - 2400, '1H', 34, [42, 'Arsenal'], [49, 'Chelsea'], 1, 0),
  fx(2, NOW / 1000 - 90000, 'FT', 90, [40, 'Liverpool'], [47, 'Tottenham'], 2, 2),
  fx(4, NOW / 1000 + 3600, 'PST', null, [33, 'Manchester United'], [34, 'Newcastle'], null, null),
] };
const pf = AF.parseFixtures(fixturesJson);
assert.deepStrictEqual(pf.map((m) => m.id), ['af:2', 'af:1', 'af:4', 'af:3'], 'sorted by kick-off');
const live = pf.find((m) => m.id === 'af:1');
assert.deepStrictEqual([live.state, live.label, live.home.score, live.away.score, live.home.abbr, live.src], ['in', "34'", 1, 0, 'ARS', 'af']);
assert.strictEqual(pf.find((m) => m.id === 'af:3').home.score, null, 'no score before kick-off');
assert.strictEqual(pf.find((m) => m.id === 'af:4').state, 'off');
assert.strictEqual(pf.find((m) => m.id === 'af:2').home.abbr, 'LIV');

const row = (rank, id, name, p, w, d, l, gf, ga, pts, group) => ({ rank, team: { id, name, logo: 'x.png' }, points: pts, goalsDiff: gf - ga, group, all: { played: p, win: w, draw: d, lose: l, goals: { for: gf, against: ga } } });
const st = AF.parseStandings({ response: [{ league: { standings: [[row(1, 42, 'Arsenal', 10, 8, 1, 1, 22, 6, 25, 'Premier League'), row(2, 40, 'Liverpool', 10, 7, 1, 2, 20, 10, 22, 'Premier League')]] } }] });
assert.strictEqual(st.length, 1); assert.strictEqual(st[0].name, '', 'single table has no group heading');
assert.deepStrictEqual([st[0].rows[0].rank, st[0].rows[0].abbr, st[0].rows[0].gd, st[0].rows[0].pts, st[0].rows[1].w], [1, 'ARS', 16, 25, 7]);
const grp = AF.parseStandings({ response: [{ league: { standings: [[row(1, 1, 'A', 1, 1, 0, 0, 1, 0, 3, 'Group A')], [row(1, 2, 'B', 1, 1, 0, 0, 2, 0, 3, 'Group B')]] } }] });
assert.deepStrictEqual(grp.map((g) => g.name), ['Group A', 'Group B']);
assert.deepStrictEqual(AF.parseStandings({}), []);

/* ---------- client + provider chain ---------- */
(async () => {
  let clock = NOW, key = 'KEY123', remaining = 90;
  const calls = [];
  let mode = 'ok'; // ok | plan | requests | token
  const espnBoard = { events: [{ id: 'e1', date: new Date(NOW + 3600000).toISOString(), competitions: [{ competitors: [
    { homeAway: 'home', score: '0', team: { id: '359', displayName: 'Arsenal FC', shortDisplayName: 'Arsenal', abbreviation: 'ARS' } },
    { homeAway: 'away', score: '0', team: { id: '363', displayName: 'Chelsea FC', shortDisplayName: 'Chelsea', abbreviation: 'CHE' } }], status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } } }] }] };
  const espnTable = { children: [{ standings: { entries: [{ team: { id: '359', displayName: 'Arsenal FC', shortDisplayName: 'Arsenal', abbreviation: 'ARS' }, stats: [{ name: 'points', value: 25 }] }] } }] };
  const fetchFn = async (url, opts) => {
    calls.push({ url, headers: opts && opts.headers });
    if (url.includes('api-sports.io')) {
      remaining--;
      const headers = { get: (h) => ({ 'x-ratelimit-requests-remaining': String(remaining), 'x-ratelimit-requests-limit': '100' })[h] };
      if (mode === 'plan') return { ok: true, headers, json: async () => ({ errors: { plan: 'Free plans do not have access to this season, try from 2021 to 2023.' }, response: [] }) };
      if (mode === 'requests') return { ok: true, headers, json: async () => ({ errors: { requests: 'You have reached the request limit for the day' }, response: [] }) };
      if (mode === 'token') return { ok: true, headers, json: async () => ({ errors: { token: 'Error/Missing application key' }, response: [] }) };
      return { ok: true, headers, json: async () => (url.includes('/standings') ? { errors: [], response: [{ league: { standings: [[row(1, 42, 'Arsenal', 10, 8, 1, 1, 22, 6, 25, 'PL')]] } }] } : fixturesJson) };
    }
    return { ok: true, json: async () => (url.includes('/standings') ? espnTable : espnBoard) };
  };
  const afCalls = () => calls.filter((c) => c.url.includes('api-sports.io'));
  const fb = S.createFootball({ fetchFn, clock: () => clock, getKey: () => key });

  // 1. with a key: API-Football is used, with the right auth header, league id, season and window
  let b = await fb.bundle('eng.1');
  assert.strictEqual(b.src, 'af'); assert.strictEqual(b.source, 'API-Football');
  const f1 = afCalls().find((c) => c.url.includes('/fixtures'));
  assert.strictEqual(f1.headers['x-apisports-key'], 'KEY123');
  assert.ok(f1.url.startsWith('https://v3.football.api-sports.io/fixtures?'));
  const q = new URL(f1.url).searchParams;
  assert.deepStrictEqual([q.get('league'), q.get('season'), q.get('from'), q.get('to')], ['39', '2026', '2026-10-29', '2026-11-08']);
  assert.strictEqual(b.fixtures.length, 4); assert.strictEqual(b.table[0].rows[0].abbr, 'ARS');
  assert.strictEqual(b.quota.remaining, 88); assert.strictEqual(b.quota.limit, 100);

  // 2. cached: no further requests inside the TTL; fixtures refresh after 5 minutes (not 45 s) on API-Football
  let n = calls.length; await fb.bundle('eng.1'); assert.strictEqual(calls.length, n);
  clock += 2 * 60000; await fb.fixtures('eng.1'); assert.strictEqual(calls.length, n, 'still cached at 2 min');
  clock += 4 * 60000; await fb.fixtures('eng.1'); assert.strictEqual(calls.length, n + 1);
  clock += 2000; await fb.fixtures('eng.1', { maxAge: 1000 }); assert.strictEqual(calls.length, n + 2, 'maxAge forces a refresh (live polling)');

  // 3. free plan without the current season -> falls back to ESPN for that call, and stops asking API-Football
  const fb2 = S.createFootball({ fetchFn, clock: () => clock, getKey: () => key });
  mode = 'plan'; calls.length = 0;
  b = await fb2.bundle('eng.1');
  assert.strictEqual(b.src, 'espn'); assert.ok(/Free plans do not have access/.test(b.quota.note), b.quota.note);
  const before = afCalls().length;
  clock += 10 * 60000; await fb2.bundle('eng.1');
  assert.strictEqual(afCalls().length, before, 'plan-blocked: no more API-Football calls for 6 h');
  mode = 'ok'; clock += 7 * 3600000; await fb2.fixtures('eng.1', { maxAge: 0 });
  assert.ok(afCalls().length > before, 'retried after the block expires');

  // 4. quota nearly used up -> ESPN takes over automatically
  const fb3 = S.createFootball({ fetchFn, clock: () => clock, getKey: () => key });
  remaining = 14; await fb3.fixtures('esp.1'); // header now says 13 remaining (> reserve 12)
  remaining = 12; await fb3.fixtures('esp.1', { maxAge: 0 }); // header says 11 -> at/below reserve
  calls.length = 0; const r = await fb3.fixtures('esp.1', { maxAge: 0 });
  assert.strictEqual(r.src, 'espn'); assert.strictEqual(afCalls().length, 0);
  assert.ok(/quota nearly used up/.test(fb3.bundle && (await fb3.bundle('esp.1')).quota.note));

  // 5. daily limit reached / bad key
  const fb4 = S.createFootball({ fetchFn, clock: () => clock, getKey: () => key }); remaining = 90; mode = 'requests';
  assert.strictEqual((await fb4.fixtures('ita.1')).src, 'espn');
  assert.ok(/quota used up/.test((await fb4.bundle('ita.1')).quota.note));
  const fb5 = S.createFootball({ fetchFn, clock: () => clock, getKey: () => key }); mode = 'token';
  assert.strictEqual((await fb5.fixtures('ger.1')).src, 'espn');
  assert.ok(/rejected the key/.test((await fb5.bundle('ger.1')).quota.note));
  mode = 'ok'; key = 'FIXED'; assert.strictEqual((await fb5.fixtures('ger.1', { maxAge: 0 })).src, 'af', 'a new key clears the block');

  // 6. no key at all -> ESPN only, never touches API-Football
  key = ''; calls.length = 0; const fb6 = S.createFootball({ fetchFn, clock: () => clock, getKey: () => key });
  assert.strictEqual((await fb6.bundle('fra.1')).src, 'espn'); assert.strictEqual(afCalls().length, 0);
  // leagues API-Football doesn't know fall back too (and polling stays gentle on a metered key)
  assert.strictEqual(fb6.liveInterval('espn'), 45000);

  // 7. followed team keeps working when the provider changes mid-match (ids differ, names match; state key is provider-agnostic)
  const alerts = [];
  const mkM = (src, id, hs, label) => ({ id, src, date: NOW - 1800000, state: 'in', label, home: { id: src === 'af' ? '42' : '359', name: 'Arsenal', full: src === 'af' ? 'Arsenal' : 'Arsenal FC', score: hs }, away: { id: src === 'af' ? '49' : '363', name: 'Chelsea', full: 'Chelsea', score: 0 } });
  let frame = 0;
  const swap = { fixtures: async () => (frame === 0 ? { src: 'af', items: [mkM('af', 'af:1', 0, "20'")] } : { src: 'espn', items: [mkM('espn', 'e1', 1, "34'")] }) };
  const w = new S.LiveWatcher({ football: swap, getSettings: () => ({ favTeams: [{ league: 'eng.1', id: '359', src: 'espn', name: 'Arsenal', full: 'Arsenal FC' }], footballAlerts: true }), notify: (a) => alerts.push(a), onLive: () => {}, onSummary: () => {}, clock: () => clock });
  await w.tick(true); frame = 1; await w.tick(true);
  assert.deepStrictEqual(alerts.map((a) => a.title), ['GOAL! Arsenal'], 'goal detected across providers, no duplicate kick-off alert');

  // 8. several followed teams in different leagues, one live
  const multi = []; const lives = []; const sums = [];
  const mkTeam = (id, n) => ({ id, name: n, full: n, abbr: n.slice(0, 3).toUpperCase(), logo: '', score: 0 });
  const fixturesBy = { 'eng.1': [{ id: 'a', src: 'espn', date: clock + 36e5 * 5, state: 'pre', label: '', home: mkTeam('1', 'Liverpool'), away: mkTeam('2', 'Everton') }],
    'esp.1': [{ id: 'b', src: 'espn', date: clock - 36e5, state: 'in', label: "60'", home: mkTeam('3', 'Barcelona'), away: mkTeam('4', 'Sevilla') }] };
  const w2 = new S.LiveWatcher({ football: { fixtures: async (l) => ({ src: 'espn', items: fixturesBy[l] }), liveInterval: () => 45000 },
    getSettings: () => ({ favTeams: [{ league: 'eng.1', id: '1', src: 'espn', name: 'Liverpool' }, { league: 'esp.1', id: '3', src: 'espn', name: 'Barcelona' }], footballAlerts: true }),
    notify: (a) => multi.push(a), onLive: (m) => lives.push(m), onSummary: (m) => sums.push(m), clock: () => clock });
  await w2.tick(true);
  assert.strictEqual(lives[0].id, 'b'); assert.strictEqual(lives[0].favSide, 'home'); assert.strictEqual(sums[0].id, 'b', 'live match wins the summary');
  assert.strictEqual(w2.nextPoll, clock + 45000);

  console.log('api-football tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
