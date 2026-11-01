const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, net, dialog, globalShortcut, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { createServer } = require('./server');
const calendar = require('./calendar');
const notifs = require('./notifications');
const { startClipboard } = require('./clipboard');
const sports = require('./sports');
const { annotate, sameName } = require('./teams');
const { createSpotify } = require('./spotify');
const claudeHooks = require('./claudehooks');
const { createLiveManager } = require('./f1live');

const PORT = Number(process.env.ISLET_PORT) || 47615;
const WIN_W = 700;
const WIN_H = 380;
const MAX_TEAMS = 6, MAX_DRIVERS = 3;
const SPOTIFY_REDIRECT = `http://127.0.0.1:${PORT}/spotify/callback`;

if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('com.islet.app');

let win = null;
let onboardWin = null;
let tray = null;
let mediaProc = null;
let notifProc = null;
let bridge = null;
let clips = null;
let spotify = null;
let calendarTimer = null;

const DEFAULTS = {
  notch: true, musicPill: true, sound: true, popupFromNotifs: false, clipboard: true, icsUrl: '',
  footballLeague: 'eng.1', favTeams: [], footballAlerts: true, f1Alerts: true, favDrivers: [], favConstructor: '',
  apiFootballKey: '', spotifyClientId: '', onboarded: false,
  f1Ambient: true, f1CalmLights: false, f1LiveWatch: true,
  modules: { sports: true, focus: true, tasks: true }, nbaTeams: [], quietFocus: true,
};
let settings = { ...DEFAULTS };
const userFile = (n) => path.join(app.getPath('userData'), n);

/* last known data, re-sent when a window (re)loads */
let calState = { events: [], error: '', configured: false, updated: 0 };
let notifState = { items: [], error: '', fresh: [] };
let football = null, f1 = null, watcher = null, f1Reminders = null, sportsTimer = null, basketball = null;
let liveMatch = null;
const summary = { fav: null, f1: null, f1fav: null };

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const broadcast = (ch, payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload); };
// The API key never goes to the renderer, only whether one is set and its last 4 characters.
const publicSettings = () => {
  const { apiFootballKey, ...rest } = settings;
  const oc = loadOpenF1Creds();
  return { ...rest, openf1User: oc ? oc.user : '', apiFootballKeySet: !!apiFootballKey, apiFootballKeyTail: apiFootballKey ? apiFootballKey.slice(-4) : '', autostart: app.getLoginItemSettings().openAtLogin };
};

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')) }; } catch { /* first run */ }
  if (settings.favTeam && !(settings.favTeams || []).length) settings.favTeams = [settings.favTeam]; // older versions followed one team
  delete settings.favTeam;
  if (!Array.isArray(settings.favTeams)) settings.favTeams = [];
  if (!Array.isArray(settings.nbaTeams)) settings.nbaTeams = [];
  settings.modules = { ...DEFAULTS.modules, ...(settings.modules && typeof settings.modules === 'object' ? settings.modules : {}) };
}
function persist() { try { fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings)); } catch { /* ignore */ } }
function saveSettings() {
  persist();
  broadcast('settings', publicSettings());
  buildTrayMenu();
}

/* ---------- the island window ---------- */
function positionWindow() {
  const d = screen.getPrimaryDisplay();
  win.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2), y: d.bounds.y, width: WIN_W, height: WIN_H });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, x: 0, y: 0,
    transparent: true, frame: false, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 1); // above the ambient light window
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true }); // click-through until the pointer is over the island
  positionWindow();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', pushAll);
  win.on('blur', () => win.setFocusable(false)); // only focusable while you type in Notes / Settings
  screen.on('display-metrics-changed', () => { if (win) positionWindow(); if (ambientWin && !ambientWin.isDestroyed()) ambientWin.setBounds(ambientBounds()); });
}

function pushAll() {
  send('settings', publicSettings());
  send('calendar', calState);
  send('notifs', { ...notifState, fresh: [] });
  send('live', liveMatch);
  send('summary', summary);
  for (const e of [liveCache.session, liveCache.outline, liveCache.flag, liveCache.status]) if (e) send('f1live', e);
  if (clips) send('clips', clips.items());
}

/* ---------- onboarding ---------- */
function openOnboarding() {
  if (onboardWin && !onboardWin.isDestroyed()) { onboardWin.show(); onboardWin.focus(); return; }
  onboardWin = new BrowserWindow({
    width: 760, height: 660, frame: false, transparent: true, resizable: false, center: true, show: false, hasShadow: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  onboardWin.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'));
  onboardWin.once('ready-to-show', () => onboardWin.show());
  onboardWin.webContents.on('did-finish-load', () => onboardWin.webContents.send('settings', publicSettings()));
  onboardWin.on('closed', () => {
    onboardWin = null;
    if (!settings.onboarded) { settings.onboarded = true; saveSettings(); } // closing early counts as skipping; re-run from the tray any time
  });
}
function finishOnboarding() {
  const first = !settings.onboarded;
  settings.onboarded = true;
  saveSettings();
  if (onboardWin && !onboardWin.isDestroyed()) onboardWin.close();
  if (first) send('alert', { title: 'You’re all set', body: 'Hover the top of your screen to open the panel', icon: '🏝️', duration: 6000 });
}

/* ---------- Windows media controls ---------- */
function startMedia() {
  if (process.platform !== 'win32') return;
  mediaProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'media.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  lineReader(mediaProc.stdout, (o) => send('media', o));
  mediaProc.on('exit', () => { mediaProc = null; });
}

function lineReader(stream, cb) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { cb(JSON.parse(line)); } catch { /* partial / noise */ }
    }
  });
}

/* ---------- Windows notification database (read-only) ---------- */
let notifFirst = true;
const seenNotif = new Set();
function startNotifications() {
  if (process.platform !== 'win32') { notifState.error = 'Windows notifications are only available on Windows.'; return; }
  notifProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'notifications.ps1')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  lineReader(notifProc.stdout, (o) => {
    if (o.error) { notifState = { ...notifState, error: o.error, fresh: [] }; send('notifs', notifState); return; }
    const items = notifs.toItems(Array.isArray(o.items) ? o.items : o.items ? [o.items] : []);
    const fresh = notifFirst ? [] : items.filter((i) => !seenNotif.has(i.id)).map((i) => i.id);
    items.forEach((i) => seenNotif.add(i.id));
    notifFirst = false;
    notifState = { items, error: '', fresh };
    send('notifs', notifState);
  });
  notifProc.on('exit', () => { notifProc = null; });
}

/* ---------- calendar ---------- */
async function refreshCalendar() {
  const url = (settings.icsUrl || '').trim();
  if (!url) { calState = { events: [], error: '', configured: false, updated: Date.now() }; send('calendar', calState); return; }
  try {
    const events = await calendar.loadEvents(url, { fetchFn: (u, o) => net.fetch(u, o) });
    calState = { events, error: '', configured: true, updated: Date.now() };
  } catch (e) {
    calState = { ...calState, error: e.message || String(e), configured: true, updated: Date.now() };
  }
  send('calendar', calState);
}

/* ---------- Spotify ---------- */
function loadSpotifyTokens() {
  try {
    const raw = fs.readFileSync(userFile('spotify.dat'), 'utf8');
    return JSON.parse(safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(raw, 'base64')) : raw);
  } catch { return null; }
}
function saveSpotifyTokens(t) {
  const f = userFile('spotify.dat');
  try {
    if (!t) { fs.rmSync(f, { force: true }); return; }
    const json = JSON.stringify(t);
    fs.writeFileSync(f, safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json).toString('base64') : json); // DPAPI-encrypted on Windows
  } catch { /* ignore */ }
}
function startSpotify() {
  spotify = createSpotify({
    fetchFn: (u, o) => net.fetch(u, o), getClientId: () => settings.spotifyClientId, redirectUri: SPOTIFY_REDIRECT,
    loadTokens: loadSpotifyTokens, saveTokens: saveSpotifyTokens,
  });
}
const spErr = (e) => ({ ok: false, kind: e.kind || 'error', message: e.message || String(e) });
ipcMain.handle('spotify-status', () => ({ hasClient: !!settings.spotifyClientId, connected: spotify.connected(), redirectUri: SPOTIFY_REDIRECT }));
ipcMain.handle('spotify-connect', () => {
  try { shell.openExternal(spotify.begin()); return { ok: true }; } catch (e) { return spErr(e); }
});
ipcMain.handle('spotify-disconnect', () => { spotify.disconnect(); broadcast('spotify-changed'); return { ok: true }; });
ipcMain.handle('spotify-state', async () => { try { return { ok: true, state: await spotify.state() }; } catch (e) { return spErr(e); } });
ipcMain.handle('spotify-cmd', async (_e, cmd, arg) => { try { await spotify.command(String(cmd), arg); return { ok: true }; } catch (e) { return spErr(e); } });
ipcMain.handle('spotify-playlists', async () => { try { return { ok: true, items: await spotify.playlists() }; } catch (e) { return spErr(e); } });
ipcMain.handle('spotify-devices', async () => { try { return { ok: true, items: await spotify.devices() }; } catch (e) { return spErr(e); } });

/* ---------- local server: Claude Code hooks, alert API, Spotify callback ---------- */
function startBridge() {
  bridge = createServer({
    port: PORT,
    onNotify: (a) => send('alert', a),
    onClaudeActivity: (a) => send('claude', { kind: 'activity', ...a }),
    onClaudeDone: (a) => send('claude', { kind: 'done', ...a }),
    onPermission: (p) => send('permission', p),
    onSpotifyCallback: async (q) => {
      try { await spotify.handleCallback(q); broadcast('spotify-changed'); return { ok: true, message: 'You can close this tab and go back to Islet.' }; } catch (e) { return { ok: false, message: e.message }; }
    },
  });
  bridge.listen().catch((e) => console.error('Islet bridge failed to start:', e.message));
}

/* ---------- OpenF1 account (optional, encrypted) ---------- */
function loadOpenF1Creds() {
  try {
    const raw = fs.readFileSync(userFile('openf1.dat'), 'utf8');
    const c = JSON.parse(safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(raw, 'base64')) : raw);
    return c && typeof c.user === 'string' && typeof c.pass === 'string' ? c : null;
  } catch { return null; }
}
function saveOpenF1Creds(c) {
  const f = userFile('openf1.dat');
  try {
    if (!c) { fs.rmSync(f, { force: true }); return; }
    const json = JSON.stringify({ user: c.user, pass: c.pass });
    fs.writeFileSync(f, safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json).toString('base64') : json);
  } catch { /* ignore */ }
}

/* ---------- ambient light: a click-through glow along the top edge of the screen ---------- */
let ambientWin = null, ambientHide = null;
function ambientBounds() { const d = screen.getPrimaryDisplay(); return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: 260 }; }
function ensureAmbient() {
  if (ambientWin && !ambientWin.isDestroyed()) return ambientWin;
  ambientWin = new BrowserWindow({
    ...ambientBounds(), transparent: true, frame: false, resizable: false, movable: false, skipTaskbar: true, hasShadow: false,
    focusable: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  ambientWin.setAlwaysOnTop(true, 'screen-saver', 0);
  ambientWin.setVisibleOnAllWorkspaces(true);
  ambientWin.setIgnoreMouseEvents(true);
  ambientWin.loadFile(path.join(__dirname, 'renderer', 'ambient.html'));
  return ambientWin;
}
function ambientSet(msg) {
  clearTimeout(ambientHide);
  if (msg.mode === 'off') { if (ambientWin && !ambientWin.isDestroyed() && ambientWin.isVisible()) { ambientWin.webContents.send('ambient', msg); ambientHide = setTimeout(() => ambientWin && !ambientWin.isDestroyed() && ambientWin.hide(), 900); } return; }
  const w = ensureAmbient();
  w.setBounds(ambientBounds());
  const go = () => { w.webContents.send('ambient', { ...msg, calm: !!settings.f1CalmLights }); if (!w.isVisible()) w.showInactive(); };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  // transient effects hide themselves once they have played
  const life = msg.pulse ? 3600 : msg.mode === 'chequered' ? 14000 : 0;
  if (life) ambientHide = setTimeout(() => { ambientSet({ mode: 'off' }); }, life);
}
function ambientFor(flag, pulse) {
  if (!settings.f1Ambient) return;
  if (flag.mode === 'green') { if (pulse) ambientSet({ mode: 'green', pulse: true }); else ambientSet({ mode: 'off' }); return; }
  ambientSet({ mode: flag.mode });
}

/* ---------- live F1: track map, flags, ambient light ---------- */
let live = null;
const liveCache = { session: null, outline: null, flag: null, status: null };
function onLiveEvent(e) {
  if (e.type === 'session') { liveCache.session = e; liveCache.outline = null; liveCache.flag = null; liveCache.status = null; }
  else if (e.type === 'outline') liveCache.outline = e;
  else if (e.type === 'flag') { liveCache.flag = e; ambientFor(e, e.pulseGreen); }
  else if (e.type === 'status' || e.type === 'idle') liveCache.status = e;
  else if (e.type === 'stopped') { liveCache.session = liveCache.outline = liveCache.flag = null; liveCache.status = e; ambientSet({ mode: 'off' }); }
  send('f1live', e);
}
function startLive() {
  if (!live) {
    live = createLiveManager({
      fetchFn: (u, o) => net.fetch(u, o), getCreds: loadOpenF1Creds, emit: onLiveEvent,
      onAlert: (a) => { if (settings.f1Alerts) send('alert', { ...a, duration: 6000 }); },
    });
  }
  if (settings.f1LiveWatch && settings.modules.sports) live.startWatch();
}
ipcMain.handle('f1live-do', async (_e, cmd) => {
  if (!live || !cmd || typeof cmd.a !== 'string') return { ok: false };
  try {
    switch (cmd.a) {
      case 'replay': await live.replay(['latest', 'race', 'qualifying', 'sprint'].includes(cmd.kind) ? cmd.kind : 'latest'); break;
      case 'demo': await live.demo(); break;
      case 'stop': live.stop(); break;
      case 'speed': if ([1, 4, 16].includes(cmd.x)) live.setSpeed(cmd.x); break;
      case 'jump': return { ok: live.jumpNextFlag() };
      case 'watch': await live.watchOnce(); break;
      default: return { ok: false };
    }
    return { ok: true };
  } catch (e) { const msg = (e && e.message) || String(e); onLiveEvent({ type: 'status', error: msg, kind: e && e.kind }); return { ok: false, error: msg }; }
});
ipcMain.handle('f1live-login', async (_e, c) => {
  const user = str(c && c.user, 160).trim(), pass = str(c && c.pass, 200);
  if (!user || !pass || /\s/.test(user)) return { ok: false, error: 'Enter the email and password of your OpenF1 account' };
  saveOpenF1Creds({ user, pass });
  live.auth.forget();
  try { await live.auth.login(); } catch (e) { saveOpenF1Creds(null); live.auth.forget(); broadcast('settings', publicSettings()); return { ok: false, error: e.message }; }
  broadcast('settings', publicSettings());
  live.watchOnce();
  return { ok: true };
});
ipcMain.handle('f1live-logout', () => { saveOpenF1Creds(null); if (live) live.auth.forget(); broadcast('settings', publicSettings()); return { ok: true }; });

/* ---------- basketball (NBA) ---------- */
const MAX_NBA = 5;
function cleanNbaTeam(t) {
  if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 12) return null;
  return {
    id: t.id, name: str(t.name, 60), full: str(t.full || t.name, 80), abbr: str(t.abbr, 5),
    logo: /^https:\/\/a\.espncdn\.com\//.test(t.logo || '') ? t.logo : '',
  };
}
ipcMain.handle('nba-get', () => (basketball && settings.modules.sports
  ? basketball.bundle().then((b) => ({ ...b, favs: settings.nbaTeams.map((t) => t.id) }))
  : { disabled: true, games: [], groups: [], error: '', favs: [] }));

/* ---------- tasks (a plain checklist, kept on this PC) ---------- */
function cleanTasks(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, 200).filter((t) => t && typeof t.id === 'string' && t.id.length <= 40)
    .map((t) => ({ id: t.id, text: str(t.text, 200).trim(), done: !!t.done })).filter((t) => t.text);
}
function loadTasks() { try { return cleanTasks(JSON.parse(fs.readFileSync(userFile('tasks.json'), 'utf8'))) || []; } catch { return []; } }
ipcMain.handle('tasks-load', () => loadTasks());
ipcMain.handle('tasks-save', (_e, list) => {
  const c = cleanTasks(list);
  if (!c) return { ok: false };
  try { fs.writeFileSync(userFile('tasks.json'), JSON.stringify(c)); return { ok: true }; } catch { return { ok: false }; }
});

/* ---------- football + F1 ---------- */
function startSports() {
  if (sportsTimer) return;                           // already running
  const fetchFn = (u, o) => net.fetch(u, o);
  football = sports.createFootball({ fetchFn, getKey: () => settings.apiFootballKey });
  f1 = sports.createF1({ fetchFn });
  basketball = sports.createBasketball({ fetchFn });
  watcher = new sports.LiveWatcher({
    football, getSettings: () => settings,
    notify: (a) => send('alert', a),
    onLive: (m) => { liveMatch = m; send('live', m); },
    onSummary: (m) => { summary.fav = m; send('summary', summary); },
  });
  f1Reminders = new sports.F1Reminders({ notify: (a) => send('alert', a) });
  sportsTimer = setInterval(sportsTick, 30000);
  sportsTick();
}
function stopSports() {
  clearInterval(sportsTimer); sportsTimer = null;
  liveMatch = null; summary.fav = null; summary.f1 = null; summary.f1fav = null;
  send('live', null); send('summary', summary);
}
async function sportsTick() {
  if (!settings.modules.sports || !watcher) return;
  try { await watcher.tick(); } catch { /* network hiccup: try again next tick */ }
  try {
    const races = await f1.schedule();
    f1Reminders.check(races, settings.f1Alerts);
    const ns = sports.nextSession(races, Date.now());
    summary.f1 = ns ? { race: ns.race.name, round: ns.race.round, label: ns.session.label, start: ns.session.start } : null;
  } catch { /* offline */ }
  try {
    if ((settings.favDrivers || []).length || settings.favConstructor) {
      const [d, t] = await Promise.allSettled([f1.drivers(), f1.teams()]);
      summary.f1fav = sports.f1Favourites(d.value, t.value, settings.favDrivers, settings.favConstructor);
    } else summary.f1fav = null;
  } catch { summary.f1fav = null; }
  send('summary', summary);
}
const asError = (league) => (e) => ({ league, error: e.message || String(e), fixtures: [], table: [], source: '', quota: {} });
ipcMain.handle('football-get', (_e, league) => (football && settings.modules.sports ? football.bundle(String(league)).then((b) => annotate(b, settings.favTeams)).catch(asError(String(league))) : { disabled: true, league: String(league), fixtures: [], table: [], error: '' }));
ipcMain.handle('f1-get', () => (f1 && settings.modules.sports ? f1.bundle().catch((e) => ({ error: e.message || String(e), races: [], drivers: { rows: [] }, teams: { rows: [] }, last: null })) : { disabled: true, races: [], drivers: { rows: [] }, teams: { rows: [] }, last: null, error: '' }));

/* ---------- Claude Code connection ---------- */
const hookScript = () => path.join(__dirname, 'hook.ps1');
async function connectClaude() {
  const file = claudeHooks.settingsPath();
  const r = await dialog.showMessageBox({
    type: 'question', buttons: ['Connect', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Connect Claude Code',
    message: 'Add Islet’s hooks to Claude Code?',
    detail: `This adds a few hook entries to:\n${file}\n\nYour other settings are kept and a backup is saved next to it. Restart Claude Code afterwards.`,
  });
  if (r.response !== 0) return { ok: false, cancelled: true };
  try { claudeHooks.connect(file, hookScript()); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; }
}
ipcMain.handle('claude-status', () => claudeHooks.status());
ipcMain.handle('claude-connect', connectClaude);
ipcMain.handle('claude-disconnect', () => {
  try { claudeHooks.disconnect(claudeHooks.settingsPath()); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; }
});

/* ---------- tray ---------- */
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Test alert', click: () => send('alert', { title: 'Islet is running', body: 'Alerts look like this', icon: '🏝️', duration: 3500 }) },
    { label: 'Set up Islet…', click: openOnboarding },
    { type: 'separator' },
    { label: 'Show the notch when idle', type: 'checkbox', checked: settings.notch, click: (m) => update({ notch: m.checked }) },
    { label: 'Show music pill', type: 'checkbox', checked: settings.musicPill, click: (m) => update({ musicPill: m.checked }) },
    { label: 'Alert sounds', type: 'checkbox', checked: settings.sound, click: (m) => update({ sound: m.checked }) },
    { label: 'Clipboard history', type: 'checkbox', checked: settings.clipboard, click: (m) => update({ clipboard: m.checked }) },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (m) => update({ autostart: m.checked }) },
    { label: 'Connect Claude Code…', click: () => { connectClaude().then((r) => { if (r.ok) send('alert', { title: 'Claude Code connected', body: 'Restart Claude Code to start seeing activity here', icon: '✳️', duration: 6000 }); }); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Islet');
  buildTrayMenu();
}

/* ---------- settings updates from tray / UI ---------- */
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function cleanTeam(t) {
  if (!t || !sports.isLeague(t.league) || typeof t.id !== 'string' || !t.id || t.id.length > 20) return null;
  return {
    league: t.league, id: t.id, src: t.src === 'af' ? 'af' : 'espn', name: str(t.name, 60), full: str(t.full || t.name, 80), abbr: str(t.abbr, 10),
    logo: /^https:\/\/(a\.espncdn\.com|media\.api-sports\.io)\//.test(t.logo || '') ? t.logo : '',
  };
}

function update(patch) {
  const prevIcs = settings.icsUrl, prevKey = settings.apiFootballKey;
  for (const k of ['notch', 'musicPill', 'sound', 'popupFromNotifs', 'clipboard', 'footballAlerts', 'f1Alerts', 'f1Ambient', 'f1CalmLights', 'f1LiveWatch', 'quietFocus']) if (typeof patch[k] === 'boolean') settings[k] = patch[k];
  if (typeof patch.icsUrl === 'string') settings.icsUrl = patch.icsUrl.trim().slice(0, 2000);
  if (typeof patch.footballLeague === 'string' && sports.isLeague(patch.footballLeague)) settings.footballLeague = patch.footballLeague;
  if (typeof patch.apiFootballKey === 'string') {
    const k = patch.apiFootballKey.trim();
    if (!k || /^[A-Za-z0-9]{16,64}$/.test(k)) settings.apiFootballKey = k;
  }
  if (typeof patch.spotifyClientId === 'string') {
    const k = patch.spotifyClientId.trim();
    if (!k || /^[A-Za-z0-9]{20,64}$/.test(k)) { if (k !== settings.spotifyClientId && spotify) spotify.disconnect(); settings.spotifyClientId = k; }
  }
  if (typeof patch.onboarded === 'boolean') settings.onboarded = patch.onboarded;

  if (patch.modules && typeof patch.modules === 'object') {
    const was = settings.modules.sports;
    for (const k of ['sports', 'focus', 'tasks']) if (typeof patch.modules[k] === 'boolean') settings.modules[k] = patch.modules[k];
    if (settings.modules.sports !== was) {
      if (settings.modules.sports) { startSports(); startLive(); }
      else { stopSports(); if (live) { live.stopWatch(); live.stop(); } }
    }
  }
  if (patch.toggleNbaTeam) {
    const t = cleanNbaTeam(patch.toggleNbaTeam);
    if (t) {
      if (settings.nbaTeams.some((x) => x.id === t.id)) settings.nbaTeams = settings.nbaTeams.filter((x) => x.id !== t.id);
      else if (settings.nbaTeams.length < MAX_NBA) settings.nbaTeams = [...settings.nbaTeams, t];
      else send('alert', { title: `Up to ${MAX_NBA} NBA teams`, body: 'Unfollow one to add another', icon: '🏀', duration: 3500 });
    }
  }
  let favChanged = false, f1Changed = false;
  if (patch.clearFavTeams) { settings.favTeams = []; favChanged = true; }
  if (patch.toggleFavTeam) {
    const t = cleanTeam(patch.toggleFavTeam);
    if (t) {
      const same = (f) => f.league === t.league && ((f.src === t.src && f.id === t.id) || sameName(f.full || f.name, t.full || t.name));
      if (settings.favTeams.some(same)) settings.favTeams = settings.favTeams.filter((f) => !same(f));
      else if (settings.favTeams.length >= MAX_TEAMS) send('alert', { title: `Up to ${MAX_TEAMS} teams`, body: 'Unfollow one to add another', icon: '⚽', duration: 3500 });
      else settings.favTeams = [...settings.favTeams, t];
      favChanged = true;
    }
  }
  if (typeof patch.toggleFavDriver === 'string' && /^[A-Z]{3}$/.test(patch.toggleFavDriver)) {
    const c = patch.toggleFavDriver;
    if (settings.favDrivers.includes(c)) settings.favDrivers = settings.favDrivers.filter((x) => x !== c);
    else if (settings.favDrivers.length < MAX_DRIVERS) settings.favDrivers = [...settings.favDrivers, c];
    f1Changed = true;
  }
  if (typeof patch.favConstructor === 'string') { settings.favConstructor = settings.favConstructor === patch.favConstructor ? '' : str(patch.favConstructor, 40); f1Changed = true; }
  if (typeof patch.autostart === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: patch.autostart, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
  }
  saveSettings();
  if (!settings.f1Ambient) ambientSet({ mode: 'off' });
  else if (live && liveCache.flag) ambientFor(liveCache.flag, false);
  if (live) { if (settings.f1LiveWatch && settings.modules.sports) live.startWatch(); else live.stopWatch(); }
  if (settings.icsUrl !== prevIcs) refreshCalendar();
  if (settings.apiFootballKey !== prevKey && football) { football.clear(); favChanged = true; }
  if (favChanged && watcher) {
    watcher.reset();
    if (!settings.favTeams.length) { liveMatch = null; summary.fav = null; send('live', null); send('summary', summary); }
    sportsTick();
  } else if (f1Changed) sportsTick();
}

/* ---------- IPC ---------- */
const LINK_HOSTS = new Set(['www.api-football.com', 'dashboard.api-football.com', 'developer.spotify.com', 'accounts.spotify.com', 'openf1.org', 'www.openf1.org']);
ipcMain.on('hover', (_e, over) => { if (win) win.setIgnoreMouseEvents(!over, { forward: true }); });
ipcMain.on('focusable', (_e, on) => {
  if (!win) return;
  win.setFocusable(!!on);
  if (on) win.focus();
});
ipcMain.on('media-cmd', (_e, cmd) => {
  if (mediaProc && ['playpause', 'next', 'prev'].includes(cmd)) mediaProc.stdin.write(cmd + '\n');
});
ipcMain.on('decide', (_e, { id, decision }) => bridge && bridge.resolvePermission(id, decision));
ipcMain.on('settings-update', (_e, patch) => update(patch || {}));
ipcMain.on('calendar-refresh', () => refreshCalendar());
ipcMain.on('open-join', (_e, url) => { if (calendar.isAllowedJoinUrl(url)) shell.openExternal(url); });
ipcMain.on('open-link', (_e, url) => {
  try { const u = new URL(url); if (u.protocol === 'https:' && LINK_HOSTS.has(u.hostname)) shell.openExternal(u.href); } catch { /* ignore */ }
});
ipcMain.on('onboarding-open', openOnboarding);
ipcMain.on('onboarding-done', finishOnboarding);
ipcMain.on('window-close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && w === onboardWin) w.close(); });
ipcMain.on('clip-copy', (_e, id) => clips && clips.copyBack(id));
ipcMain.on('clip-clear', () => clips && clips.clear());
ipcMain.on('clip-drag', (e, id) => {
  const info = clips && clips.dragInfo(id);
  if (info && info.file) {
    try { e.sender.startDrag({ file: info.file, icon: info.icon }); } catch (err) { console.error('drag failed', err.message); }
  }
  e.sender.send('drag-end');
});
ipcMain.handle('note-load', () => { try { return fs.readFileSync(userFile('notes.txt'), 'utf8'); } catch { return ''; } });
ipcMain.handle('note-save', (_e, text) => {
  try {
    const f = userFile('notes.txt');
    fs.writeFileSync(f + '.tmp', String(text).slice(0, 200000));
    fs.renameSync(f + '.tmp', f);
    return true;
  } catch { return false; }
});

app.whenReady().then(() => {
  loadSettings();
  if (app.isPackaged && !settings.autostartInit) { // first run of the installed app: start with Windows (switch off in Settings or the tray)
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [] });
    settings.autostartInit = true;
    persist();
  }
  clips = startClipboard({
    dir: path.join(os.tmpdir(), 'islet-clips'),
    isEnabled: () => settings.clipboard,
    onChange: (items) => send('clips', items),
  });
  startSpotify();
  createWindow();
  startBridge();
  startMedia();
  startNotifications();
  if (settings.modules.sports) { startSports(); startLive(); }
  buildTray();
  // Ctrl+Alt+I pins the island open / closed from anywhere
  try { globalShortcut.register('CommandOrControl+Alt+I', () => send('toggle-pin')); } catch { /* shortcut taken by another app */ }
  refreshCalendar();
  if (!settings.onboarded) setTimeout(openOnboarding, 500);
  calendarTimer = setInterval(refreshCalendar, 10 * 60 * 1000);
});
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => {
  clearInterval(calendarTimer);
  clearInterval(sportsTimer);
  if (live) { live.stopWatch(); live.stop(); }
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  if (mediaProc) mediaProc.kill();
  if (notifProc) notifProc.kill();
  if (clips) clips.stop();
  if (bridge) bridge.close();
});
