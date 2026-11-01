const assert = require('assert');
const { LiveFeed, createLiveManager } = require('../f1live');
const { createDemoSource, BASE, LENGTH, DRIVERS } = require('../f1demo');
const O = require('../openf1');

(async () => {
  /* ---------- OpenF1 client: URLs, filters, auth, errors, normalisation ---------- */
  assert.strictEqual(O.qs([['session_key', 9161], ['date>=', '2026-11-01T14:03:35.200'], ['date<', '2026-11-01T14:03:41.200']]),
    'session_key=9161&date>=2026-11-01T14:03:35.200&date<2026-11-01T14:03:41.200');
  assert.strictEqual(O.ts('2026-11-01T14:03:35.200000+00:00'), Date.UTC(2026, 10, 1, 14, 3, 35, 200));
  assert.strictEqual(O.ts('2026-11-01T14:03:35.200'), Date.UTC(2026, 10, 1, 14, 3, 35, 200), 'no zone = UTC');
  assert.strictEqual(O.iso(Date.UTC(2026, 10, 1, 14, 3, 35, 200)), '2026-11-01T14:03:35.200');
  assert.strictEqual(O.cleanOutline([{ x: 0, y: 0, t: 1 }, { x: 100, y: 100, t: 2 }, { x: 101, y: 100, t: 3 }, { x: 400, y: 100, t: 4 }]).length, 2, 'drops the 0,0 glitch and near-duplicates');

  const calls = [];
  let creds = null, mode = 'ok';
  const res = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (h) => headers[h.toLowerCase()] }, json: async () => body });
  const SESSION = { session_key: 9999, meeting_key: 1, session_name: 'Race', session_type: 'Race', circuit_short_name: 'Mexico City', country_name: 'Mexico', year: 2026, date_start: '2026-11-01T20:00:00+00:00', date_end: '2026-11-01T22:00:00+00:00' };
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, auth: opts.headers && opts.headers.Authorization, body: opts.body });
    if (url === O.TOKEN_URL) { const b = new URLSearchParams(opts.body); return b.get('password') === 'good' ? res(200, { access_token: 'TOK', expires_in: 3600 }) : res(401, { detail: 'Incorrect credentials' }); }
    if (mode === 'rate') return res(429, {}, { 'retry-after': '7' });
    if (mode === 'auth') return res(401, {});
    if (mode === 'empty') return res(404, { detail: 'No results found.' });
    const u = new URL(url);
    if (u.pathname === '/v1/sessions') return res(200, [SESSION]);
    if (u.pathname === '/v1/drivers') return res(200, [{ driver_number: 1, name_acronym: 'VER', full_name: 'Max VERSTAPPEN', team_name: 'Red Bull Racing', team_colour: '3671C6' }]);
    if (u.pathname === '/v1/race_control') return res(200, [{ date: '2026-11-01T20:30:00+00:00', category: 'Flag', flag: 'YELLOW', scope: 'Sector', sector: 7, message: 'YELLOW IN TRACK SECTOR 7', lap_number: 5 }, { date: '2026-11-01T20:10:00+00:00', category: 'SessionStatus', message: 'SESSION STARTED' }]);
    if (u.pathname === '/v1/location') return res(200, [{ driver_number: 1, x: 100, y: 200, date: '2026-11-01T20:30:01.000000+00:00' }, { driver_number: 1, x: 'bad', y: 2, date: '2026-11-01T20:30:02+00:00' }]);
    if (u.pathname === '/v1/position') return res(200, [{ driver_number: 1, position: 3, date: '2026-11-01T20:30:00+00:00' }]);
    if (u.pathname === '/v1/intervals') return res(200, [{ driver_number: 1, gap_to_leader: 4.2, interval: 1.1, date: '2026-11-01T20:30:00+00:00' }]);
    return res(404, []);
  };
  const auth = O.createAuth({ fetchFn, getCreds: () => creds });
  const api = O.createOpenF1({ fetchFn, auth });

  const s = await api.latestSession();
  assert.deepStrictEqual([s.key, s.name, s.circuit, s.start, s.end], [9999, 'Race', 'Mexico City', Date.UTC(2026, 10, 1, 20), Date.UTC(2026, 10, 1, 22)]);
  assert.ok(calls[0].url.endsWith('/v1/sessions?session_key=latest'));
  assert.strictEqual(calls[0].auth, undefined, 'no credentials: unauthenticated request');
  const src = api.sourceFor(s);
  assert.deepStrictEqual(await src.drivers(), [{ n: 1, code: 'VER', name: 'Max VERSTAPPEN', team: 'Red Bull Racing', color: '#3671C6' }]);
  const loc = await src.location(Date.UTC(2026, 10, 1, 20, 30), Date.UTC(2026, 10, 1, 20, 30, 6));
  assert.deepStrictEqual(loc, [{ n: 1, x: 100, y: 200, t: Date.UTC(2026, 10, 1, 20, 30, 1) }], 'bad rows dropped');
  assert.ok(calls.at(-1).url.includes('/v1/location?session_key=9999&date>=2026-11-01T20:30:00.000&date<2026-11-01T20:30:06.000'), calls.at(-1).url);
  const rc = await src.raceControl(0);
  assert.deepStrictEqual(rc.map((e) => e.message), ['SESSION STARTED', 'YELLOW IN TRACK SECTOR 7'], 'sorted by time'); assert.ok(!calls.at(-1).url.includes('date<'));
  assert.deepStrictEqual((await src.positions(0))[0], { n: 1, pos: 3, t: Date.UTC(2026, 10, 1, 20, 30) });
  assert.deepStrictEqual((await src.intervals(0))[0], { n: 1, gap: 4.2, int: 1.1, t: Date.UTC(2026, 10, 1, 20, 30) });

  creds = { user: 'me@x.com', pass: 'good' };
  await api.latestSession();
  const tokenCall = calls.find((c) => c.url === O.TOKEN_URL);
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(tokenCall.body)), { username: 'me@x.com', password: 'good' });
  assert.strictEqual(calls.at(-1).auth, 'Bearer TOK'); assert.ok(auth.signedIn());
  creds = { user: 'me@x.com', pass: 'bad' }; auth.forget();
  await assert.rejects(() => api.latestSession(), (e) => e.kind === 'auth' && /Incorrect credentials/.test(e.message));
  mode = 'rate'; creds = null; await assert.rejects(() => api.latestSession(), (e) => e.kind === 'rate' && e.retryAfter === 7);
  mode = 'auth'; await assert.rejects(() => api.latestSession(), (e) => e.kind === 'auth' && /account/.test(e.message));
  mode = 'empty'; assert.deepStrictEqual(await src.location(0, 1), []); assert.strictEqual(await api.latestSession(), null);
  mode = 'ok';

  /* ---------- feed over the offline demo: positions, tower, flags in order, speed, jump, loop ---------- */
  let now = 1_800_000_000_000;
  const events = []; const emit = (e) => events.push(e);
  const demo = createDemoSource();
  const feed = new LiveFeed({ source: demo, clock: () => now, emit, mode: 'replay', speed: 1, startAt: BASE, loop: true });
  await feed.start({ autoTick: false });
  assert.strictEqual(events[0].type, 'session'); assert.strictEqual(events[0].drivers.length, 22); assert.ok(events[0].session.demo);
  const outlineEv = events.find((e) => e.type === 'outline'); assert.ok(outlineEv && outlineEv.path.length === 360 && outlineEv.kind === 'lap');
  assert.ok(outlineEv.path.every(([x, y]) => x >= 0 && y >= 0 && x <= outlineEv.view.w && y <= outlineEv.view.h), 'outline fits its view box');
  const tickTo = async (sec, step = 250) => { const target = now + sec * 1000; while (now < target) { now += step; await feed.tick(); } };
  const flags = () => events.filter((e) => e.type === 'flag');

  await tickTo(2);
  const f0 = events.filter((e) => e.type === 'frame').at(-1);
  assert.strictEqual(f0.cars.length, 22); assert.ok(f0.cars.every((c) => c.x >= 0 && c.x <= outlineEv.view.w && c.y >= 0 && c.y <= outlineEv.view.h));
  const withTower = events.filter((e) => e.type === 'frame' && e.tower).at(-1);
  assert.strictEqual(withTower.tower[0].pos, 1); assert.strictEqual(withTower.tower.length, 22); assert.strictEqual(withTower.tower[0].n, DRIVERS[0].n, 'pole sitter leads at the start');

  await tickTo(35); // t = 37 s: yellows at 8-22 s, SC at 30 s
  const seq = flags().map((f) => f.mode);
  assert.deepStrictEqual(seq.filter((m, i) => m !== seq[i - 1]), ['green', 'yellow', 'green', 'sc'], seq.join(','));
  const greens = flags().filter((f) => f.pulseGreen); assert.strictEqual(greens.length, 1, 'one green flash when the yellows cleared');
  assert.strictEqual(flags().at(-1).sign, 'SC'); assert.strictEqual(flags().at(-1).label, 'SAFETY CAR');
  assert.ok(flags().at(-1).messages.some((m) => /SAFETY CAR DEPLOYED/.test(m.text)));
  assert.ok(flags().find((f) => f.mode === 'yellow').lap >= 1);

  await tickTo(30); // t = 67 s: SC in this lap (50), green (58)
  const m2 = flags().map((f) => f.mode); assert.ok(m2.includes('sc-end')); assert.strictEqual(m2.at(-1), 'green');
  await tickTo(35); // t = 102 s: VSC (68), VSC ending (80), green (86), red (96)
  const m3 = flags().map((f) => f.mode).filter((m, i, a) => m !== a[i - 1]); assert.deepStrictEqual(m3.slice(-6), ['sc-end', 'green', 'vsc', 'vsc-end', 'green', 'red']);
  assert.strictEqual(feed.snapshot().flag.mode, 'red');
  const parked = events.filter((e) => e.type === 'frame').slice(-1)[0], parkedLater = (await tickTo(3), events.filter((e) => e.type === 'frame').slice(-1)[0]);
  assert.deepStrictEqual(parked.cars.map((c) => [c.x, c.y]), parkedLater.cars.map((c) => [c.x, c.y]), 'cars are stationary under the red flag');

  // jumping to the next flag event rebuilds the state at that point
  feed.restart(); events.length = 0; await tickTo(1);
  assert.strictEqual(feed.jumpToNextFlag(), true); await tickTo(1);
  assert.strictEqual(flags().at(-1).mode, 'green', 'state just before the next event');
  await tickTo(5); assert.strictEqual(flags().at(-1).mode, 'yellow');

  // speed: 4x moves the playhead four times as fast
  const ph0 = feed.playhead(); now += 1000; assert.strictEqual(feed.playhead() - ph0, 1000); feed.setSpeed(4); const ph1 = feed.playhead(); now += 1000; assert.strictEqual(feed.playhead() - ph1, 4000);

  // loop: running past the end restarts the demo instead of stopping
  feed.setSpeed(16); events.length = 0; await tickTo(10, 500);
  assert.ok(events.some((e) => e.type === 'frame')); assert.ok(!events.some((e) => e.type === 'status' && e.ended));
  const nonLoop = new LiveFeed({ source: createDemoSource(), clock: () => now, emit: (e) => events.push(e), mode: 'replay', speed: 1, startAt: BASE + (LENGTH + 5) * 1000 });
  await nonLoop.start({ autoTick: false }); events.length = 0; await nonLoop.tick();
  assert.ok(events.some((e) => e.type === 'status' && e.ended), 'a replay past the end reports it ended'); feed.stop();

  /* ---------- live mode: joins mid-session, applies flags as they arrive, backs off when rate limited ---------- */
  let liveNow = Date.UTC(2026, 10, 1, 20, 31);
  const liveEvents = []; let rcRows = [{ t: Date.UTC(2026, 10, 1, 20, 10), category: 'SessionStatus', message: 'SESSION STARTED' }, { t: Date.UTC(2026, 10, 1, 20, 25), category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' }];
  let failLoc = null; const liveCalls = { loc: 0, rc: 0 };
  const liveSrc = {
    session: async () => ({ key: 1, name: 'Race', circuit: 'Mexico City', country: 'Mexico', start: Date.UTC(2026, 10, 1, 20), end: Date.UTC(2026, 10, 1, 22) }),
    drivers: async () => DRIVERS.slice(0, 2), outline: async () => null,
    location: async (from) => { liveCalls.loc++; if (failLoc) throw failLoc; return [1, 2].flatMap((n) => [0, 1, 2, 3, 4].map((k) => ({ n, x: n * 1000 + (from % 1e5) / 10 + k * 40, y: n * 500 + k * 40, t: from + k * 270 }))); },
    raceControl: async (from) => { liveCalls.rc++; return rcRows.filter((r) => r.t >= from); }, positions: async () => [], intervals: async () => [],
  };
  const live = new LiveFeed({ source: liveSrc, clock: () => liveNow, emit: (e) => liveEvents.push(e), mode: 'live', fast: true });
  await live.start({ autoTick: false });
  assert.strictEqual(liveEvents.filter((e) => e.type === 'flag').at(-1).mode, 'sc', 'joining mid-session shows the current status straight away');
  for (let i = 0; i < 12; i++) { liveNow += 500; await live.tick(); }
  assert.ok(liveEvents.some((e) => e.type === 'outline' && e.kind === 'trail'), 'no clean lap yet: draws the trail of the first car');
  assert.ok(liveEvents.some((e) => e.type === 'frame' && e.cars.length === 2));
  rcRows = [...rcRows, { t: liveNow - 1000, category: 'Flag', flag: 'GREEN', scope: 'Track', message: 'GREEN LIGHT' }];
  liveNow += 4000; await live.tick(); await live.tick();
  const last = liveEvents.filter((e) => e.type === 'flag').at(-1); assert.deepStrictEqual([last.mode, last.pulseGreen], ['green', true]);
  failLoc = new O.OpenF1Error('rate', 'OpenF1 is rate limiting', 429, 9); const before = liveCalls.loc;
  liveNow += 5000; await live.tick(); assert.ok(liveEvents.some((e) => e.type === 'status' && /rate limiting/.test(e.error)));
  const afterFail = liveCalls.loc; liveNow += 3000; await live.tick(); assert.strictEqual(liveCalls.loc, afterFail, 'honours Retry-After before asking again'); assert.ok(afterFail > before);
  failLoc = null; liveNow += 20000; await live.tick(); await live.tick(); assert.ok(liveEvents.some((e) => e.type === 'status' && e.error === ''), 'recovers and clears the error');

  /* ---------- manager: demo + stop; watcher only goes live inside the session window ---------- */
  const mEvents = [], alerts = [];
  let wall = Date.UTC(2026, 10, 1, 20, 31);
  const mgr = createLiveManager({ fetchFn, getCreds: () => null, emit: (e) => mEvents.push(e), onAlert: (a) => alerts.push(a), clock: () => wall });
  await mgr.watchOnce();
  assert.strictEqual(mgr.mode, 'live'); assert.deepStrictEqual(alerts.map((a) => a.title), ['F1 session live']); assert.ok(mEvents.some((e) => e.type === 'session' && e.feedMode === 'live' && !e.mode));
  wall = Date.UTC(2026, 10, 1, 23, 0); await mgr.watchOnce();
  assert.strictEqual(mgr.mode, 'idle', 'session ended: back to idle'); assert.ok(mEvents.some((e) => e.type === 'idle' && e.last.name === 'Race'));
  await mgr.demo(); assert.strictEqual(mgr.mode, 'demo'); assert.strictEqual(mgr.snapshot().feed.session.demo, true);
  assert.deepStrictEqual(Object.keys(mgr.snapshot().feed), ['session', 'drivers', 'speed', 'live', 'flag']);
  mgr.stop(); assert.strictEqual(mgr.mode, 'idle');

  console.log('f1 live tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
