process.env.TZ = 'Asia/Karachi';
const assert = require('assert');
const S = require('../sports');

/* ---------- fixtures shaped like the public ESPN / Jolpica responses ---------- */
const team = (id, name, abbr) => ({ id, displayName: name + ' FC', shortDisplayName: name, abbreviation: abbr, logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` });
const ev = (id, date, home, away, hs, as, type) => ({
  id, date, competitions: [{
    competitors: [
      { homeAway: 'home', score: hs, team: home },
      { homeAway: 'away', score: as, team: away },
    ],
    status: { displayClock: type.clock || '0\'', type: { state: type.state, name: type.name, detail: type.detail || '', shortDetail: type.short || '' } },
  }],
});
const ARS = team('359', 'Arsenal', 'ARS'), CHE = team('363', 'Chelsea', 'CHE'), LIV = team('364', 'Liverpool', 'LIV'), MCI = team('382', 'Man City', 'MCI');

const scoreboard = { events: [
  ev('1', '2026-11-01T12:30:00Z', ARS, CHE, '0', '0', { state: 'pre', name: 'STATUS_SCHEDULED' }),
  ev('2', '2026-11-01T11:00:00Z', LIV, MCI, '1', '1', { state: 'in', name: 'STATUS_IN_PROGRESS', clock: "34'" }),
  ev('3', '2026-10-31T15:00:00Z', MCI, ARS, '2', '0', { state: 'post', name: 'STATUS_FULL_TIME' }),
  ev('4', '2026-11-01T14:00:00Z', CHE, LIV, '1', '0', { state: 'in', name: 'STATUS_HALFTIME', clock: "45'" }),
  ev('5', '2026-11-02T15:00:00Z', ARS, LIV, '', '', { state: 'post', name: 'STATUS_POSTPONED' }),
  { id: '6', date: '2026-11-03T15:00:00Z', competitions: [{ competitors: [] }] }, // malformed -> skipped
] };
const sb = S.parseScoreboard(scoreboard);
assert.strictEqual(sb.length, 5);
assert.deepStrictEqual(sb.map((m) => m.id), ['3', '2', '1', '4', '5']); // sorted by kickoff
const byId = Object.fromEntries(sb.map((m) => [m.id, m]));
assert.strictEqual(byId['2'].state, 'in'); assert.strictEqual(byId['2'].label, "34'"); assert.strictEqual(byId['2'].home.score, 1);
assert.strictEqual(byId['4'].label, 'HT');
assert.strictEqual(byId['3'].label, 'FT'); assert.strictEqual(byId['3'].home.abbr, 'MCI');
assert.strictEqual(byId['1'].home.score, 0); assert.strictEqual(byId['1'].state, 'pre');
assert.strictEqual(byId['5'].state, 'off'); assert.strictEqual(byId['5'].home.score, null);

const entry = (t, rank, p, w, d, l, gf, ga, pts) => ({ team: { id: t.id, displayName: t.displayName, shortDisplayName: t.shortDisplayName, abbreviation: t.abbreviation, logos: [{ href: 'x.png' }] },
  stats: [['rank', rank], ['gamesPlayed', p], ['wins', w], ['ties', d], ['losses', l], ['pointsFor', gf], ['pointsAgainst', ga], ['pointDifferential', gf - ga], ['points', pts]].map(([name, value]) => ({ name, value })) });
const standings = { children: [{ name: 'English Premier League', standings: { entries: [entry(LIV, 2, 10, 7, 1, 2, 20, 10, 22), entry(ARS, 1, 10, 8, 1, 1, 22, 6, 25)] } }] };
const tb = S.parseStandings(standings);
assert.strictEqual(tb.length, 1);
assert.deepStrictEqual(tb[0].rows.map((r) => [r.rank, r.abbr, r.played, r.gd, r.pts]), [[1, 'ARS', 10, 16, 25], [2, 'LIV', 10, 10, 22]]);
// abbreviation-only stats and missing rank still work
const alt = S.parseStandings({ children: [{ standings: { entries: [{ team: { id: '1', displayName: 'A' }, stats: [{ abbreviation: 'GP', value: 3 }, { abbreviation: 'PTS', value: 7 }, { abbreviation: 'GD', value: 4 }] }] } }] });
assert.deepStrictEqual([alt[0].rows[0].rank, alt[0].rows[0].played, alt[0].rows[0].pts, alt[0].rows[0].gd], [1, 3, 7, 4]);
assert.deepStrictEqual(S.parseStandings({}), []);

/* ---------- F1 ---------- */
const sched = { MRData: { RaceTable: { Races: [
  { season: '2026', round: '19', raceName: 'United States Grand Prix', Circuit: { circuitName: 'Circuit of the Americas', Location: { locality: 'Austin', country: 'USA' } },
    date: '2026-10-25', time: '19:00:00Z', FirstPractice: { date: '2026-10-23', time: '17:30:00Z' }, SprintQualifying: { date: '2026-10-23', time: '21:30:00Z' },
    Sprint: { date: '2026-10-24', time: '18:00:00Z' }, Qualifying: { date: '2026-10-24', time: '22:00:00Z' } },
  { season: '2026', round: '20', raceName: 'Mexico City Grand Prix', Circuit: { circuitName: 'Autódromo Hermanos Rodríguez', Location: { locality: 'Mexico City', country: 'Mexico' } },
    date: '2026-11-01', time: '20:00:00Z', FirstPractice: { date: '2026-10-30', time: '18:30:00Z' }, SecondPractice: { date: '2026-10-30', time: '22:00:00Z' },
    ThirdPractice: { date: '2026-10-31', time: '17:30:00Z' }, Qualifying: { date: '2026-10-31', time: '21:00:00Z' } },
  { season: '2026', round: '21', raceName: 'São Paulo Grand Prix', Circuit: { circuitName: 'Interlagos', Location: { locality: 'São Paulo', country: 'Brazil' } },
    date: '2026-11-08', time: '17:00:00Z', FirstPractice: { date: '2026-11-06', time: '14:30:00Z' }, Qualifying: { date: '2026-11-07', time: '18:00:00Z' } },
] } } };
const races = S.parseSchedule(sched);
assert.strictEqual(races.length, 3);
assert.deepStrictEqual(races[0].sessions.map((s) => s.label), ['FP1', 'Sprint Qualifying', 'Sprint', 'Qualifying', 'Race']);
assert.ok(races[0].sprint && !races[1].sprint);
assert.strictEqual(races[1].sessions.at(-1).start, Date.parse('2026-11-01T20:00:00Z'));
const NOW = Date.parse('2026-11-01T07:00:00Z');
assert.strictEqual(S.nextRace(races, NOW).round, 20);
assert.strictEqual(S.nextRace(races, Date.parse('2026-11-01T23:30:00Z')).round, 21); // race over (+3h) -> next
const ns = S.nextSession(races, NOW);
assert.deepStrictEqual([ns.race.round, ns.session.label], [20, 'Race']);

const drv = S.parseDriverStandings({ MRData: { StandingsTable: { StandingsLists: [{ season: '2026', round: '19', DriverStandings: [
  { position: '1', positionText: '1', points: '363', wins: '7', Driver: { code: 'NOR', permanentNumber: '4', givenName: 'Lando', familyName: 'Norris' }, Constructors: [{ name: 'McLaren' }] },
  { position: '2', points: '350', wins: '6', Driver: { givenName: 'Max', familyName: 'Verstappen' }, Constructors: [{ name: 'Red Bull' }, { name: 'RB' }] },
] }] } } });
assert.deepStrictEqual([drv.season, drv.round, drv.rows[0].code, drv.rows[0].points, drv.rows[1].code, drv.rows[1].team], ['2026', 19, 'NOR', 363, 'VER', 'RB']);
const con = S.parseConstructorStandings({ MRData: { StandingsTable: { StandingsLists: [{ ConstructorStandings: [{ position: '1', points: '700', wins: '12', Constructor: { name: 'McLaren' } }] }] } } });
assert.deepStrictEqual(con.rows[0], { pos: 1, name: 'McLaren', points: 700, wins: 12 });
const last = S.parseLastResult({ MRData: { RaceTable: { Races: [{ raceName: 'United States Grand Prix', round: '19', date: '2026-10-25', time: '19:00:00Z', Circuit: { circuitName: 'COTA' }, Results: [
  { position: '1', positionText: '1', points: '25', Driver: { code: 'NOR', givenName: 'Lando', familyName: 'Norris' }, Constructor: { name: 'McLaren' }, grid: '2', laps: '56', status: 'Finished', Time: { time: '1:34:00.1' }, FastestLap: { rank: '1' } },
  { position: '20', positionText: 'R', points: '0', Driver: { code: 'HAM', givenName: 'Lewis', familyName: 'Hamilton' }, Constructor: { name: 'Ferrari' }, grid: '5', laps: '12', status: 'Engine' },
] }] } } });
assert.deepStrictEqual([last.name, last.results[0].fastest, last.results[1].pos, last.results[1].time], ['United States Grand Prix', true, 'R', '']);
assert.strictEqual(S.parseLastResult({ MRData: { RaceTable: { Races: [] } } }), null);
assert.deepStrictEqual(S.parseSchedule({}), []);

/* ---------- fetch + cache ---------- */
(async () => {
  const urls = [];
  let clockMs = NOW;
  const fakeFetch = async (url) => {
    urls.push(url);
    const json = url.includes('/scoreboard') ? scoreboard : url.includes('/standings') && url.includes('espn') ? standings
      : url.includes('driverStandings') ? { fail: 1 } : url.endsWith('current.json?limit=60') ? sched : null;
    if (url.includes('driverStandings')) return { ok: false, status: 503 };
    if (json === null) return { ok: false, status: 404 };
    return { ok: true, json: async () => json };
  };
  const fb = S.createFootball({ fetchFn: fakeFetch, clock: () => clockMs });
  const b = await fb.bundle('eng.1');
  assert.strictEqual(b.fixtures.length, 5); assert.strictEqual(b.table[0].rows.length, 2); assert.strictEqual(b.error, '');
  const fxUrl = urls.find((u) => u.includes('/scoreboard'));
  assert.ok(fxUrl.includes('/soccer/eng.1/scoreboard?dates=20261029-20261108'), fxUrl);
  const n = urls.length;
  await fb.bundle('eng.1');
  assert.strictEqual(urls.length, n, 'second call within TTL is served from cache');
  clockMs += 60000; await fb.fixtures('eng.1');
  assert.strictEqual(urls.length, n + 1, 'fixtures refresh after 45 s, standings do not');
  await assert.rejects(() => fb.bundle('nope.1'), /Unknown league/);

  const f1 = S.createF1({ fetchFn: fakeFetch, clock: () => clockMs });
  const fb1 = await f1.bundle();
  assert.strictEqual(fb1.races.length, 3);
  assert.deepStrictEqual(fb1.drivers.rows, []);
  assert.ok(/drivers: .*503/.test(fb1.error) && /teams/.test(fb1.error), fb1.error); // partial failure is reported, not fatal

  /* ---------- ESPN refuses the date range -> fall back to one request per day (and remember) ---------- */
  {
    const urls2 = [];
    const day = (u) => new URL(u).searchParams.get('dates');
    const fetch400 = async (url) => {
      urls2.push(url);
      if (!url.includes('/scoreboard')) return { ok: true, json: async () => standings };
      const d = day(url);
      if (d.includes('-')) return { ok: false, status: 400 };
      const evs = d === '20261101' ? [scoreboard.events[0], scoreboard.events[1]] : d === '20261102' ? [scoreboard.events[1], scoreboard.events[2]] : [];
      return { ok: true, json: async () => ({ events: evs }) };
    };
    const fb = S.createFootball({ fetchFn: fetch400, clock: () => NOW });
    const r = await fb.fixtures('eng.1');
    assert.strictEqual(r.src, 'espn');
    assert.deepStrictEqual(r.items.map((m) => m.id).sort(), ['1', '2', '3'], 'days merged, duplicate event ids dropped');
    assert.ok(urls2.some((u) => day(u) && day(u).includes('-')), 'tried the range first');
    assert.ok(!urls2.some((u) => /limit=/.test(u)), 'no limit parameter');
    assert.strictEqual(urls2.filter((u) => !day(u).includes('-')).length, 9, 'nine single-day requests');
    urls2.length = 0; await fb.fixtures('eng.1', { maxAge: 0 });
    assert.ok(!urls2.some((u) => day(u).includes('-')), 'does not ask for the range again');
    // a network failure (no HTTP status) must not switch strategy
    const fb2 = S.createFootball({ fetchFn: async () => { throw new Error('offline'); }, clock: () => NOW });
    await assert.rejects(() => fb2.fixtures('eng.1'), /offline/);
  }

  /* ---------- cache: fails loudly with no data, serves stale data when a refresh fails ---------- */
  {
    let now = 0, fail = true, calls = 0;
    const c = S.makeCache(() => now);
    await assert.rejects(() => c('k', 1000, async () => { calls++; throw new Error('down'); }), /down/);
    fail = false;
    assert.strictEqual(await c('k', 1000, async () => { calls++; return 'fresh'; }), 'fresh');
    now = 5000; // expired
    assert.strictEqual(await c('k', 1000, async () => { calls++; throw new Error('down again'); }), 'fresh', 'stale value served');
    const before = calls; now = 6000; // inside the 30 s back-off: no new request
    assert.strictEqual(await c('k', 1000, async () => { calls++; return 'x'; }), 'fresh'); assert.strictEqual(calls, before);
    now = 40000; assert.strictEqual(await c('k', 1000, async () => 'recovered'), 'recovered');
  }

  /* ---------- live watcher: follows Arsenal through a whole match ---------- */
  const alerts = []; const lives = []; const summaries = [];
  let step = 0;
  const kick = NOW + 10 * 60000;
  const frames = [
    { state: 'pre', label: '', hs: 0, as: 0, date: kick },                 // 0: 10 min to kick-off
    { state: 'in', label: "1'", hs: 0, as: 0, date: kick },               // 1: started
    { state: 'in', label: "34'", hs: 1, as: 0, date: kick },              // 2: Arsenal (home) score
    { state: 'in', label: "41'", hs: 1, as: 1, date: kick },              // 3: Chelsea equalise
    { state: 'in', label: 'HT', hs: 1, as: 1, date: kick },               // 4: half-time
    { state: 'in', label: "80'", hs: 2, as: 1, date: kick },              // 5: Arsenal again
    { state: 'post', label: 'FT', hs: 2, as: 1, date: kick },             // 6: full-time
  ];
  const fakeFootball = { fixtures: async () => {
    const f = frames[step];
    const mk = (t, score) => ({ id: t.id, name: t.shortDisplayName, full: t.displayName, abbr: t.abbreviation, logo: '', score });
    return { src: 'espn', items: [{ id: 'm1', src: 'espn', date: f.date, state: f.state, label: f.label, home: mk(ARS, f.hs), away: mk(CHE, f.as) },
            { id: 'm2', src: 'espn', date: f.date, state: 'in', label: "10'", home: mk(LIV, 0), away: mk(MCI, 0) }] };
  } };
  const settings = { favTeams: [{ league: 'eng.1', id: '359', src: 'espn', name: 'Arsenal', full: 'Arsenal FC' }], footballAlerts: true };
  const w = new S.LiveWatcher({ football: fakeFootball, getSettings: () => settings, notify: (a) => alerts.push(a), onLive: (m) => lives.push(m), onSummary: (m) => summaries.push(m), clock: () => clockMs });
  clockMs = NOW;
  for (step = 0; step < frames.length; step++) { clockMs = NOW + step * 20 * 60000; await w.tick(true); }
  assert.deepStrictEqual(alerts.map((a) => a.title), [
    'Kick-off in 10 min', 'Kick-off!', 'GOAL! Arsenal', 'Goal for Chelsea', 'Half-time', 'GOAL! Arsenal', 'Full-time']);
  assert.strictEqual(alerts[2].body, "Arsenal 1–0 Chelsea · 34'");
  assert.strictEqual(alerts.at(-1).icon, '🎉');
  assert.strictEqual(lives[0], null); assert.strictEqual(lives[2].id, 'm1'); assert.strictEqual(lives.at(-1), null);
  assert.strictEqual(summaries[0].state, 'pre'); assert.strictEqual(summaries[6].state, 'post'); // result stays visible after the final whistle
  assert.ok(!alerts.some((a) => /Liverpool|Man City/.test(a.body)), 'other matches never alert');

  // started mid-match: no catch-up alerts; alerts off: silent but still tracked
  const quiet = []; step = 2; clockMs = NOW + 60 * 60000;
  const w2 = new S.LiveWatcher({ football: fakeFootball, getSettings: () => settings, notify: (a) => quiet.push(a), onLive: () => {}, onSummary: () => {}, clock: () => clockMs });
  await w2.tick(true); assert.strictEqual(quiet.length, 0);
  settings.footballAlerts = false; step = 5; await w2.tick(true); assert.strictEqual(quiet.length, 0);
  settings.footballAlerts = true;
  settings.favTeams = []; const l3 = []; const w3 = new S.LiveWatcher({ football: fakeFootball, getSettings: () => settings, notify: () => {}, onLive: (m) => l3.push(m), onSummary: (m) => l3.push(m), clock: () => clockMs });
  await w3.tick(true); assert.deepStrictEqual(l3, [null, null]);

  /* ---------- F1 session reminders ---------- */
  const out = []; let t = Date.parse('2026-10-31T20:40:00Z'); // 20 min before Qualifying (21:00Z)
  const rem = new S.F1Reminders({ notify: (a) => out.push(a), clock: () => t });
  rem.check(races, true); assert.strictEqual(out.length, 0);
  t = Date.parse('2026-10-31T20:46:00Z'); rem.check(races, true);
  assert.deepStrictEqual(out.map((a) => a.title), ['Qualifying in 14 min']);
  rem.check(races, true); assert.strictEqual(out.length, 1, 'no repeats');
  t = Date.parse('2026-10-31T20:59:45Z'); rem.check(races, true);
  assert.strictEqual(out[1].title, 'Qualifying is starting');
  t = Date.parse('2026-10-31T20:46:00Z'); const off = []; new S.F1Reminders({ notify: (a) => off.push(a), clock: () => t }).check(races, false);
  assert.strictEqual(off.length, 0);
  t = Date.parse('2026-11-05T00:00:00Z'); const stale = []; new S.F1Reminders({ notify: (a) => stale.push(a), clock: () => t }).check(races.slice(0, 2), true);
  assert.strictEqual(stale.length, 0, 'past sessions never alert');

  console.log('sports tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
