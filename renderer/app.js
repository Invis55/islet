// Core: state machine for the island, hover handling, media, alerts, Claude Code, permissions.
// The tabbed panel lives in panel.js and talks to this file through window.UI.
const $ = (id) => document.getElementById(id);
const island = $('island');

let settings = { notch: true, musicPill: true, sound: true, popupFromNotifs: false, clipboard: true, icsUrl: '', autostart: false };
let media = { active: false };
let mediaStamp = 0;           // when `media` was received, for position interpolation
let art = '';

let rawHover = false;         // pointer is over the island / hot zone right now
let hovering = false;         // debounced version of rawHover
let typing = false;           // an input in the panel has keyboard focus
let dragging = false;         // dragging a clipboard item out of the panel
let pinned = false;           // panel held open (grabber, click on the notch, or Ctrl+Alt+I)
let hoverLock = false;        // after unpinning, ignore hover until the pointer has left
let hoverTimer = null;
let lastCapture = null;

let alertQueue = [];
let currentAlert = null;
let alertTimer = null;
let claude = null;            // { text, project }
let live = null;              // live match of the followed team
let claudeTimer = null;
const permissions = [];       // pending permission requests

const panelWanted = () => hovering || typing || dragging || pinned;
const notchVisible = () => settings.notch !== false;

/* ---------- state resolution ---------- */
function resolveState() {
  if (permissions.length) return 'permission';
  if (currentAlert) return 'alert';
  if (panelWanted()) return 'panel';
  if (claude) return 'claude';
  if (live && settings.favTeam) return 'match';
  if (media.active && media.playing && settings.musicPill) return 'music-compact';
  return 'idle';
}

function syncCapture() {
  // Only grab the mouse while a visible pill is under it; otherwise the window stays click-through.
  const want = rawHover && (island.dataset.state !== 'idle' || notchVisible());
  if (want !== lastCapture) { lastCapture = want; window.islet.setHover(want); }
}

function render() {
  const s = resolveState();
  const prev = island.dataset.state;
  island.dataset.state = s;
  document.body.classList.toggle('playing', !!(media.active && media.playing));
  island.dataset.notch = notchVisible() ? 'on' : 'off';
  island.classList.toggle('peek', rawHover && s !== 'panel' && s !== 'alert' && s !== 'permission');
  syncCapture();
  if (s === 'panel' && prev !== 'panel' && window.Panel) window.Panel.onOpen();
}

/* ---------- hover / drag / typing ---------- */
function onHoverChange() {
  render();
  if (!panelWanted() && !currentAlert && alertQueue.length) nextAlert();
}
function setRawHover(v) {
  rawHover = v;
  render();            // updates the notch "peek" swell and mouse capture straight away
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => { if (hovering !== rawHover) { hovering = rawHover; onHoverChange(); } }, v ? 230 : 380); // the notch swells first, then opens
}
document.addEventListener('mousemove', (e) => {
  const r = island.getBoundingClientRect();
  const pad = 6;
  const overIsland = (island.dataset.state !== 'idle' || notchVisible()) &&
    e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
  const overHotZone = e.clientY < 10 && Math.abs(e.clientX - innerWidth / 2) < 110;
  let over = overIsland || overHotZone;
  if (!over) hoverLock = false;
  if (hoverLock) over = false;
  if (over !== rawHover) setRawHover(over);
  // Liquid Glass: the specular highlight follows the pointer
  const g = e.target.closest && e.target.closest('.glass');
  if (g) { const r = g.getBoundingClientRect(); g.style.setProperty('--mx', `${e.clientX - r.left}px`); g.style.setProperty('--my', `${e.clientY - r.top}px`); }
});
document.addEventListener('mouseleave', () => setRawHover(false));
window.addEventListener('blur', () => { if (typing) { typing = false; onHoverChange(); } });

/* ---------- media ---------- */
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function accentFromImage(src) {
  const set = (c) => document.documentElement.style.setProperty('--accent', c);
  if (!src) { set('#1ed760'); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let best = null, bestScore = -1;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      const score = (Math.max(r, g, b) - Math.min(r, g, b)) * (Math.max(r, g, b) / 255); // vivid + bright
      if (score > bestScore) { bestScore = score; best = [r, g, b]; }
    }
    if (best) {
      const [r, g, b] = best;
      const lift = Math.max(1, 150 / Math.max(r, g, b, 1));
      set(`rgb(${Math.min(255, r * lift) | 0},${Math.min(255, g * lift) | 0},${Math.min(255, b * lift) | 0})`);
    }
  };
  img.src = src;
}

function niceSource(id = '') {
  const s = id.replace(/\.exe$/i, '').split('!')[0].split('.').pop();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function updateMediaUI() {
  const on = !!media.active;
  $('mf-title').textContent = on ? (media.title || 'Unknown') : 'Nothing playing';
  $('mf-artist').textContent = on ? [media.artist, niceSource(media.source)].filter(Boolean).join(' · ') : 'Play something in Spotify, YouTube…';
  $('mc-art').src = on ? art : '';
  $('mf-art').src = on ? art : '';
  $('mc-art').style.visibility = $('mf-art').style.visibility = on && art ? 'visible' : 'hidden';
  document.querySelector('[data-page="now"] .np').classList.toggle('idle', !on);
  tickProgress();
}

window.islet.onMedia((m) => {
  if (m.art !== undefined) { art = m.art; accentFromImage(art); }
  media = m.active ? { ...m } : { active: false };
  mediaStamp = performance.now();
  updateMediaUI();
  render();
});

function tickProgress() {
  let pos = media.active ? media.position || 0 : 0;
  if (media.active && media.playing) pos += (performance.now() - mediaStamp) / 1000;
  const dur = media.active ? media.duration || 0 : 0;
  if (dur > 0) pos = Math.min(pos, dur);
  $('mf-pos').textContent = fmt(pos);
  $('mf-dur').textContent = fmt(dur);
  $('mf-fill').style.width = dur > 0 ? `${(pos / dur) * 100}%` : '0%';
}

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => {
    const cmd = b.dataset.cmd;
    window.islet.mediaCmd(cmd);
    if (cmd === 'playpause' && media.active) { // optimistic flip until the next poll
      media.position = (media.position || 0) + (media.playing ? (performance.now() - mediaStamp) / 1000 : 0);
      media.playing = !media.playing; mediaStamp = performance.now(); render();
    }
  }));

/* ---------- sound ---------- */
let audio;
function chime(kind = 'alert') {
  if (!settings.sound) return;
  try {
    audio = audio || new AudioContext();
    (kind === 'ask' ? [660, 880] : [880, 1175]).forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = audio.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch { /* no audio device */ }
}

/* ---------- alerts ---------- */
function nextAlert() {
  clearTimeout(alertTimer);
  currentAlert = alertQueue.shift() || null;
  if (currentAlert) {
    $('al-icon').textContent = currentAlert.icon;
    $('al-title').textContent = currentAlert.title;
    $('al-body').textContent = currentAlert.body;
    chime('alert');
    alertTimer = setTimeout(nextAlert, currentAlert.duration);
  }
  render();
}
function pushAlert(a) {
  alertQueue.push(a);
  if (!currentAlert && !panelWanted()) nextAlert(); // wait until you've finished with the panel
}
window.islet.onAlert(pushAlert);

/* ---------- Claude Code ---------- */
function touchClaude() {
  clearTimeout(claudeTimer);
  claudeTimer = setTimeout(() => { claude = null; render(); }, 25000); // in case Stop never arrives
}
window.islet.onClaude((e) => {
  if (e.kind === 'activity') {
    claude = { text: e.text, project: e.project };
    $('cl-text').textContent = e.text;
    $('cl-proj').textContent = e.project || '';
    touchClaude();
  } else if (e.kind === 'done') {
    claude = null; clearTimeout(claudeTimer);
    pushAlert({ title: 'Claude is done', body: e.project ? `Finished in ${e.project}` : 'Waiting for your next prompt', icon: '✅', duration: 4500 });
  }
  render();
});

/* ---------- permission requests ---------- */
function showPermission() {
  const p = permissions[0];
  if (p) {
    $('pm-title').textContent = p.project ? `Claude wants permission · ${p.project}` : 'Claude wants permission';
    $('pm-action').textContent = p.action;
  }
  render();
}
window.islet.onPermission((p) => {
  if (p.cancel) {
    const i = permissions.findIndex((x) => x.id === p.id);
    if (i >= 0) permissions.splice(i, 1);
    showPermission();
    return;
  }
  permissions.push(p);
  if (permissions.length === 1) chime('ask');
  showPermission();
});
function decide(decision) {
  const p = permissions.shift();
  if (p) window.islet.decide(p.id, decision);
  showPermission();
}
$('pm-allow').addEventListener('click', () => decide('allow'));
$('pm-deny').addEventListener('click', () => decide('deny'));

/* ---------- live match pill ---------- */
function updateLive() {
  if (!live) return;
  $('lm-score').textContent = `${live.home.abbr} ${live.home.score ?? 0}–${live.away.score ?? 0} ${live.away.abbr}`;
  $('lm-clock').textContent = live.label || 'LIVE';
  for (const [id, side] of [['lm-home-logo', live.home], ['lm-away-logo', live.away]]) {
    const img = $(id);
    img.style.visibility = side.logo ? 'visible' : 'hidden';
    if (side.logo && img.dataset.src !== side.logo) { img.dataset.src = side.logo; img.src = side.logo; }
  }
}
window.islet.onLive((m) => { live = m; updateLive(); render(); });

/* ---------- settings + shared API for panel.js ---------- */
window.islet.onSettings((s) => { settings = s; render(); if (window.Panel) window.Panel.onSettings(s); });

function setPinned(v) {
  pinned = v;
  document.body.classList.toggle('pinned', v);
  if (!v) { hoverLock = rawHover; hovering = false; rawHover = false; lastCapture = null; } // pointer was on it (grabber click): stay closed until it leaves
  onHoverChange();
}
island.addEventListener('click', () => {
  const s = island.dataset.state;
  if (s === 'alert') { nextAlert(); return; }                       // tap an alert to dismiss it
  if (s !== 'panel' && s !== 'permission') setPinned(true);          // tap the notch or a pill to expand it
});
document.getElementById('grabber').addEventListener('click', (e) => { e.stopPropagation(); setPinned(!pinned); });
window.islet.onTogglePin(() => setPinned(!pinned));

window.UI = {
  get settings() { return settings; },
  render,
  pushAlert,
  isPanelOpen: () => island.dataset.state === 'panel',
  setPinned,
  setTyping(v) { if (typing !== v) { typing = v; onHoverChange(); } },
  setDragging(v) { if (dragging !== v) { dragging = v; onHoverChange(); } },
  tickProgress,
};

setInterval(() => { if (island.dataset.state === 'panel' && window.Panel) { window.Panel.tick(); tickProgress(); } }, 500);

updateMediaUI();
render();
