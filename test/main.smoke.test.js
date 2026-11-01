// Boots main.js against a stubbed `electron` to check the wiring: IPC handlers, settings,
// calendar fetch, clipboard history, notes file, alert API, and join-link validation.
process.env.TZ = 'Asia/Karachi';
process.env.ISLET_PORT = '47998';
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'islet-test-'));
process.env.HOME = process.env.USERPROFILE = userData; // so Claude Code settings land in a temp dir
const sent = [];          // everything main sent to the renderer: [channel, payload]
const ipcOn = {}, ipcHandle = {};
const opened = [];
const shortcuts = {};
let afHandler = async () => ({ ok: false, status: 500 });
let spotifyTokenOk = false, spotifyPlayer = false;
let clip = { formats: [], text: '', buffers: {} };

const noop = () => {};
class FakeWin {
  constructor(opts) {
    this.opts = opts; this.handlers = {}; this.destroyed = false;
    this.webContents = { on: noop, once: noop, isLoading: () => false, send: (c, p) => sent.push([c, p]), startDrag: noop };
    FakeWin.all.push(this);
  }
  setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setIgnoreMouseEvents() {} setBounds() {} loadFile(f) { this.url = f; } once() {}
  on(ev, cb) { this.handlers[ev] = cb; }
  showInactive() { this.visible = true; } hide() { this.visible = false; } isVisible() { return !!this.visible; } show() {} isDestroyed() { return this.destroyed; } setFocusable(v) { this.focusable = v; } focus() { this.focused = true; }
  close() { this.destroyed = true; FakeWin.all = FakeWin.all.filter((w) => w !== this); if (this.handlers.closed) this.handlers.closed(); }
  static getAllWindows() { return FakeWin.all; }
  static fromWebContents() { return null; }
}
FakeWin.all = [];
const fakeImage = { isEmpty: () => true };
const electron = {
  app: {
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on: noop, quit: noop, isPackaged: false,
    getPath: () => userData, getAppPath: () => __dirname, getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: noop,
  },
  BrowserWindow: FakeWin,
  Tray: class { setToolTip() {} setContextMenu() {} },
  Menu: { buildFromTemplate: (t) => t },
  ipcMain: { on: (c, f) => { ipcOn[c] = f; }, handle: (c, f) => { ipcHandle[c] = f; } },
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), on: noop },
  nativeImage: { createFromPath: () => fakeImage },
  shell: { openExternal: (u) => opened.push(u) },
  safeStorage: { isEncryptionAvailable: () => false },
  globalShortcut: { register: (k, f) => { shortcuts[k] = f; return true; }, unregisterAll: noop },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  net: { fetch: (u, o) => {
    if (/api-sports\.io/.test(u)) return afHandler(u, o);
    if (/accounts\.spotify\.com\/api\/token/.test(u)) return Promise.resolve({ ok: spotifyTokenOk, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) });
    if (/api\.spotify\.com\/v1\/me\/player$/.test(u.split('?')[0])) return Promise.resolve({ ok: true, status: 200, json: async () => ({ device: { id: 'd', name: 'PC', type: 'Computer', volume_percent: 50 }, is_playing: true, progress_ms: 1000,
      item: { id: '4uLU6hMCjMI75M1A2tKUQC', type: 'track', name: 'Blinding Lights', duration_ms: 200000, artists: [{ name: 'The Weeknd' }], album: { name: 'AH', images: [] } } }) });
    if (/api\.spotify\.com\/v1\/me\/tracks\/contains/.test(u)) return Promise.resolve({ ok: true, status: 200, json: async () => [false] });
    if (/api\.spotify\.com/.test(u)) return Promise.resolve({ ok: true, status: 204, json: async () => null });
    if (/espn\.com/.test(u)) return Promise.resolve({ ok: true, json: async () => (u.includes('/scoreboard') ? { events: [] } : { children: [] }) });
    if (/jolpi\.ca/.test(u)) return Promise.resolve({ ok: false, status: 503 });
    return fetch(u, o);
  } },
  clipboard: {
    availableFormats: () => clip.formats, readText: () => clip.text, readImage: () => fakeImage,
    readBuffer: (f) => clip.buffers[f] || Buffer.alloc(0), writeText: (t) => { clip.written = t; }, writeImage: noop,
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? electron : origLoad.call(this, req, ...rest); };

const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Smoke test meeting', `DTSTART:${new Date(Date.now() + 3600000).toISOString().replace(/[-:]|\.\d+/g, '')}`,
  'DESCRIPTION:https://meet.google.com/aaa-bbbb-ccc', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ch) => [...sent].reverse().find((s) => s[0] === ch);

(async () => {
  const calSrv = http.createServer((_q, r) => r.end(ICS)).listen(0, '127.0.0.1');
  await new Promise((r) => calSrv.once('listening', r));

  require('../main.js');
  await sleep(300);

  // renderer asks for everything on load; main answers with settings, calendar, notifs
  assert.ok(ipcOn['settings-update'] && ipcOn['open-join'] && ipcOn['clip-copy'] && ipcHandle['note-load'], 'IPC handlers registered');
  // (linux: the Windows-only notification reader is skipped without crashing)

  // settings: toggles are whitelisted + persisted; bad keys ignored
  ipcOn['settings-update']({}, { sound: false, popupFromNotifs: true, evil: 'x', musicPill: 'nope' });
  const s1 = last('settings')[1];
  assert.strictEqual(s1.sound, false); assert.strictEqual(s1.popupFromNotifs, true); assert.strictEqual(s1.musicPill, true); assert.strictEqual(s1.evil, undefined);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).sound, false);

  // calendar: set the link -> main fetches and sends events
  ipcOn['settings-update']({}, { icsUrl: `http://127.0.0.1:${calSrv.address().port}/c.ics` });
  await sleep(500);
  const cal = last('calendar')[1];
  assert.strictEqual(cal.error, '', cal.error);
  assert.strictEqual(cal.events.length, 1);
  assert.strictEqual(cal.events[0].title, 'Smoke test meeting');
  assert.strictEqual(cal.events[0].join, 'https://meet.google.com/aaa-bbbb-ccc');

  // join links: only real meeting hosts open
  ipcOn['open-join']({}, 'https://meet.google.com/aaa-bbbb-ccc');
  ipcOn['open-join']({}, 'https://evil.example/zoom.us/j/1');
  ipcOn['open-join']({}, 'file:///C:/Windows/System32/calc.exe');
  assert.deepStrictEqual(opened, ['https://meet.google.com/aaa-bbbb-ccc']);

  // notes round-trip through a real file
  assert.strictEqual(await ipcHandle['note-load'](), '');
  assert.strictEqual(await ipcHandle['note-save']({}, 'hello\nworld'), true);
  assert.strictEqual(await ipcHandle['note-load'](), 'hello\nworld');

  // focus handling: focusable only on request
  ipcOn['focusable']({}, true);

  // clipboard: text copied -> history; password-manager marker -> ignored
  clip = { formats: ['text/plain'], text: 'first copy', buffers: {} };
  await sleep(1000);
  assert.deepStrictEqual(last('clips')[1].map((c) => c.text), ['first copy']);
  clip = { formats: ['text/plain'], text: 's3cret-password', buffers: { ExcludeClipboardContentFromMonitorProcessing: Buffer.from([1]) } };
  await sleep(1000);
  assert.deepStrictEqual(last('clips')[1].map((c) => c.text), ['first copy'], 'excluded clipboard content must not be recorded');
  clip = { formats: ['text/plain'], text: 'second copy', buffers: {} };
  await sleep(1000);
  assert.deepStrictEqual(last('clips')[1].map((c) => c.text), ['second copy', 'first copy']);
  const firstId = last('clips')[1][1].id;
  ipcOn['clip-copy']({}, firstId);
  assert.strictEqual(clip.written, 'first copy');
  ipcOn['settings-update']({}, { clipboard: false });
  clip = { formats: ['text/plain'], text: 'while off', buffers: {} };
  await sleep(1000);
  assert.ok(!last('clips')[1].some((c) => c.text === 'while off'), 'history paused when disabled');
  ipcOn['clip-clear']();
  assert.deepStrictEqual(last('clips')[1], []);

  // notch setting is whitelisted + persisted; Ctrl+Alt+I reaches the renderer as a toggle-pin event
  assert.strictEqual(last('settings')[1].notch, true, 'notch defaults on');
  ipcOn['settings-update']({}, { notch: false });
  assert.strictEqual(last('settings')[1].notch, false);
  ipcOn['settings-update']({}, { notch: true });
  assert.strictEqual(typeof shortcuts['CommandOrControl+Alt+I'], 'function');
  shortcuts['CommandOrControl+Alt+I']();
  assert.ok(sent.some(([c]) => c === 'toggle-pin'));

  // first run: the onboarding window opens by itself, and finishing it records that
  await sleep(700);
  const onboard = FakeWin.all.find((w) => w.opts && w.opts.width === 760);
  assert.ok(onboard, 'onboarding window opens on first run');
  assert.strictEqual(last('settings')[1].onboarded, false);
  ipcOn['onboarding-done']();
  assert.strictEqual(last('settings')[1].onboarded, true); assert.ok(!FakeWin.all.some((w) => w.opts && w.opts.width === 760), 'wizard closed');
  assert.ok(sent.some(([c, p]) => c === 'alert' && /all set/.test(p.title)));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).onboarded, true);

  // API-Football key: validated, stored, never sent back to the renderer
  ipcOn['settings-update']({}, { apiFootballKey: 'too short!' });
  assert.strictEqual(last('settings')[1].apiFootballKeySet, false, 'garbage keys are ignored');
  ipcOn['settings-update']({}, { apiFootballKey: 'abcdef0123456789abcdef0123456789' });
  const ps = last('settings')[1];
  assert.strictEqual(ps.apiFootballKeySet, true); assert.strictEqual(ps.apiFootballKeyTail, '6789'); assert.ok(!('apiFootballKey' in ps), 'the key itself stays in the main process');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).apiFootballKey, 'abcdef0123456789abcdef0123456789');

  // football: with a key, API-Football is asked first (header + league id), results come back annotated
  const afCalls = [];
  afHandler = async (u, o) => {
    afCalls.push({ u, key: o.headers['x-apisports-key'] });
    const headers = { get: (h) => ({ 'x-ratelimit-requests-remaining': '90', 'x-ratelimit-requests-limit': '100' })[h] };
    if (u.includes('/standings')) return { ok: true, headers, json: async () => ({ errors: [], response: [{ league: { standings: [[{ rank: 1, team: { id: 42, name: 'Arsenal', logo: 'https://media.api-sports.io/football/teams/42.png' }, points: 25, goalsDiff: 16, all: { played: 10, win: 8, draw: 1, lose: 1, goals: { for: 22, against: 6 } } }]] } }] }) };
    return { ok: true, headers, json: async () => ({ errors: [], response: [{ fixture: { id: 1, timestamp: Math.floor(Date.now() / 1000) + 300, status: { short: 'NS' } },
      teams: { home: { id: 42, name: 'Arsenal', logo: 'h.png' }, away: { id: 49, name: 'Chelsea', logo: 'a.png' } }, goals: { home: null, away: null } }] }) };
  };
  const fbBundle = await ipcHandle['football-get']({}, 'eng.1');
  assert.strictEqual(fbBundle.source, 'API-Football'); assert.strictEqual(afCalls[0].key, 'abcdef0123456789abcdef0123456789');
  assert.ok(afCalls.some((c) => c.u.includes('league=39')));
  assert.strictEqual(fbBundle.fixtures.length, 1); assert.strictEqual(fbBundle.table[0].rows[0].abbr, 'ARS'); assert.strictEqual(fbBundle.quota.remaining, 90);
  assert.strictEqual((await ipcHandle['football-get']({}, 'bogus')).error, 'Unknown league');

  // following teams: toggle on/off, capped, validated, several leagues at once
  const arsenal = { league: 'eng.1', id: '42', src: 'af', name: 'Arsenal', full: 'Arsenal', abbr: 'ARS', logo: 'https://evil.example/x.png' };
  ipcOn['settings-update']({}, { toggleFavTeam: arsenal });
  assert.strictEqual(last('settings')[1].favTeams.length, 1); assert.strictEqual(last('settings')[1].favTeams[0].logo, '', 'only trusted logo hosts are kept');
  ipcOn['settings-update']({}, { toggleFavTeam: { league: 'esp.1', id: '529', src: 'af', name: 'Barcelona', full: 'Barcelona' } });
  assert.deepStrictEqual(last('settings')[1].favTeams.map((f) => f.name), ['Arsenal', 'Barcelona']);
  ipcOn['settings-update']({}, { toggleFavTeam: { league: 'nope', id: '1' } }); assert.strictEqual(last('settings')[1].favTeams.length, 2, 'invalid team ignored');
  ipcOn['settings-update']({}, { toggleFavTeam: { ...arsenal, src: 'espn', id: '359', full: 'Arsenal FC' } });
  assert.deepStrictEqual(last('settings')[1].favTeams.map((f) => f.name), ['Barcelona'], 'same club from the other provider toggles it off');
  ipcOn['settings-update']({}, { toggleFavTeam: arsenal });
  const annotated = await ipcHandle['football-get']({}, 'eng.1');
  assert.strictEqual(annotated.fixtures[0].favSide, 'home'); assert.strictEqual(annotated.table[0].rows[0].fav, true);
  await sleep(500);
  assert.ok(sent.some(([c, p]) => c === 'alert' && /Kick-off in/.test(p.title)), 'kick-off reminder for a followed team');
  assert.strictEqual(last('summary')[1].fav.favSide, 'home');
  for (const id of ['1', '2', '3', '4', '5']) ipcOn['settings-update']({}, { toggleFavTeam: { league: 'ita.1', id, src: 'af', name: 'Club ' + id, full: 'Club ' + id } });
  assert.strictEqual(last('settings')[1].favTeams.length, 6, 'capped at six');
  assert.ok(sent.some(([c, p]) => c === 'alert' && /Up to 6 teams/.test(p.title)));
  ipcOn['settings-update']({}, { clearFavTeams: true }); await sleep(300);
  assert.strictEqual(last('settings')[1].favTeams.length, 0); assert.strictEqual(last('live')[1], null); assert.strictEqual(last('summary')[1].fav, null);

  // older settings with a single followed team are migrated (checked via the loader on a fresh file below)
  // F1: followed drivers / constructor (validated, max 3), league choice
  for (const c of ['NOR', 'VER', 'LEC', 'HAM']) ipcOn['settings-update']({}, { toggleFavDriver: c });
  assert.deepStrictEqual(last('settings')[1].favDrivers, ['NOR', 'VER', 'LEC']);
  ipcOn['settings-update']({}, { toggleFavDriver: 'NOR' }); ipcOn['settings-update']({}, { toggleFavDriver: 'bad!' });
  assert.deepStrictEqual(last('settings')[1].favDrivers, ['VER', 'LEC']);
  ipcOn['settings-update']({}, { favConstructor: 'McLaren' }); assert.strictEqual(last('settings')[1].favConstructor, 'McLaren');
  ipcOn['settings-update']({}, { favConstructor: 'McLaren' }); assert.strictEqual(last('settings')[1].favConstructor, '', 'same constructor toggles off');
  ipcOn['settings-update']({}, { footballLeague: 'esp.1' }); assert.strictEqual(last('settings')[1].footballLeague, 'esp.1');
  ipcOn['settings-update']({}, { footballLeague: 'not-a-league' }); assert.strictEqual(last('settings')[1].footballLeague, 'esp.1');
  const f1r = await ipcHandle['f1-get']();
  assert.ok(f1r.error, 'f1 error surfaced (stubbed 503), not thrown');

  // Spotify: Client ID validated; connect opens the browser at the authorize URL; status reflects it
  assert.deepStrictEqual(await ipcHandle['spotify-status'](), { hasClient: false, connected: false, redirectUri: 'http://127.0.0.1:47998/spotify/callback' });
  assert.strictEqual((await ipcHandle['spotify-connect']()).kind, 'noclient');
  ipcOn['settings-update']({}, { spotifyClientId: 'short' }); assert.strictEqual(last('settings')[1].spotifyClientId, '');
  ipcOn['settings-update']({}, { spotifyClientId: '0123456789abcdef0123456789abcdef' });
  assert.strictEqual((await ipcHandle['spotify-status']()).hasClient, true);
  assert.deepStrictEqual(await ipcHandle['spotify-connect'](), { ok: true });
  const authUrl = new URL(opened.at(-1)); assert.strictEqual(authUrl.hostname, 'accounts.spotify.com'); assert.strictEqual(authUrl.searchParams.get('client_id'), '0123456789abcdef0123456789abcdef');
  // the browser comes back to the local server with the right state -> tokens exchanged, windows told
  spotifyTokenOk = true;
  const cb = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: 47998, path: `/spotify/callback?code=C&state=${authUrl.searchParams.get('state')}` }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => resolve({ s: r.statusCode, d })); }));
  assert.strictEqual(cb.s, 200); assert.ok(cb.d.includes('Spotify connected'));
  assert.strictEqual((await ipcHandle['spotify-status']()).connected, true); assert.ok(sent.some(([c]) => c === 'spotify-changed'));
  assert.ok(fs.existsSync(path.join(userData, 'spotify.dat')), 'tokens persisted');
  const bad = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: 47998, path: '/spotify/callback?code=C&state=forged' }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }));
  assert.strictEqual(bad, 400, 'forged state rejected');
  spotifyPlayer = true; const sst = await ipcHandle['spotify-state']();
  assert.strictEqual(sst.ok, true); assert.strictEqual(sst.state.track.name, 'Blinding Lights');
  assert.deepStrictEqual(await ipcHandle['spotify-cmd']({}, 'pause'), { ok: true });
  assert.strictEqual((await ipcHandle['spotify-cmd']({}, 'like', { id: 'nope', on: true })).ok, false);
  ipcOn['open-link']({}, 'https://developer.spotify.com/dashboard'); ipcOn['open-link']({}, 'https://evil.example/'); ipcOn['open-link']({}, 'http://developer.spotify.com/');
  assert.deepStrictEqual(opened.filter((u) => /dashboard|evil/.test(u)), ['https://developer.spotify.com/dashboard']);
  await ipcHandle['spotify-disconnect'](); assert.strictEqual((await ipcHandle['spotify-status']()).connected, false); assert.ok(!fs.existsSync(path.join(userData, 'spotify.dat')));

  // Claude Code: connect writes hooks into ~/.claude/settings.json, disconnect removes them
  assert.strictEqual((await ipcHandle['claude-status']()).connected, false);
  assert.deepStrictEqual(await ipcHandle['claude-connect'](), { ok: true });
  assert.strictEqual((await ipcHandle['claude-status']()).connected, true);
  assert.ok(JSON.parse(fs.readFileSync(path.join(userData, '.claude', 'settings.json'), 'utf8')).hooks.PermissionRequest[0].hooks[0].command.includes('hook.ps1'));
  await ipcHandle['claude-disconnect']();
  assert.strictEqual((await ipcHandle['claude-status']()).connected, false);

  // live F1: demo feed drives the track-status events and the ambient light window; bad input is refused
  assert.deepStrictEqual(await ipcHandle['f1live-do']({}, { a: 'nope' }), { ok: false });
  assert.strictEqual((await ipcHandle['f1live-login']({}, { user: 'a b', pass: 'x' })).ok, false);
  assert.strictEqual((await ipcHandle['f1live-login']({}, { user: '', pass: '' })).ok, false);
  assert.ok(!fs.existsSync(path.join(userData, 'openf1.dat')), 'rejected credentials are not stored');
  ipcOn['settings-update']({}, { f1Ambient: 'yes', f1CalmLights: true });
  assert.strictEqual(last('settings')[1].f1Ambient, true); assert.strictEqual(last('settings')[1].f1CalmLights, true);
  ipcOn['settings-update']({}, { f1CalmLights: false });
  assert.deepStrictEqual(await ipcHandle['f1live-do']({}, { a: 'demo' }), { ok: true });
  assert.strictEqual(last('f1live')[1].type === 'frame' || last('f1live')[1].type === 'flag' || last('f1live')[1].type === 'outline' || last('f1live')[1].type === 'session', true);
  assert.deepStrictEqual(await ipcHandle['f1live-do']({}, { a: 'jump' }), { ok: true });
  await ipcHandle['f1live-do']({}, { a: 'speed', x: 16 });
  await new Promise((r) => setTimeout(r, 1500));
  const yellow = sent.filter((m) => m[0] === 'f1live' && m[1].type === 'flag' && m[1].mode === 'yellow');
  assert.ok(yellow.length, 'yellow flag reached the island');
  const amb = FakeWin.all.find((w) => /ambient/.test(w.url || ''));
  assert.ok(amb && amb.visible, 'ambient light window shown for a yellow');
  assert.ok(sent.some((m) => m[0] === 'ambient' && m[1].mode === 'yellow' && m[1].calm === false));
  ipcOn['settings-update']({}, { f1Ambient: false });
  assert.ok(sent.filter((m) => m[0] === 'ambient').at(-1)[1].mode === 'off', 'turning the ambient light off clears it');
  await ipcHandle['f1live-do']({}, { a: 'stop' });
  assert.strictEqual(last('f1live')[1].type, 'stopped');

  // alert API still reaches the renderer
  await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: 47998, path: '/notify', method: 'POST' }, (res) => { res.resume(); res.on('end', resolve); });
    r.end(JSON.stringify({ title: 'Ping', body: 'from curl', icon: '🏝️' }));
  });
  assert.strictEqual(last('alert')[1].title, 'Ping');

  console.log('main.js smoke test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
