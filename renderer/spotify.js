// Spotify tab (Web API): now playing with seek / like / shuffle / repeat / volume, devices and playlists; plus the Settings controls.
// Only shown as controls: playback commands need Spotify Premium. All text from Spotify is set with textContent.
(() => {
  const $ = (id) => document.getElementById(id);
  const { el } = window.Panel;
  const fmt = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  let status = { hasClient: false, connected: false, redirectUri: '' };
  let st = null, stAt = 0, lastPoll = 0, polling = false, playlists = null, playlistsAt = 0, draggingVolume = false, wasConnected = null;

  const foot = (text, err) => { const f = $('sp-status'); f.textContent = text || ''; f.classList.toggle('err', !!err); };
  function handleError(r) {
    if (r.kind === 'premium') foot('Playback controls need Spotify Premium', true);
    else if (r.kind === 'nodevice') foot('No active device. Open Spotify somewhere and press play', true);
    else if (r.kind === 'noauth' || r.kind === 'auth') { foot('Spotify signed you out. Connect again in Settings', true); refreshStatus(); }
    else if (r.kind === 'rate') foot('Spotify is rate limiting. Try again in a moment', true);
    else foot(r.message || 'Spotify error', true);
  }

  /* ---------- connection state ---------- */
  async function refreshStatus() {
    status = await window.islet.spotifyStatus();
    renderConnect();
    renderSettings();
    if (wasConnected === false && status.connected) window.UI.pushAlert({ title: 'Spotify connected', body: 'Use the Spotify tab to control playback', icon: '🎧', duration: 4500 });
    wasConnected = status.connected;
  }
  function renderConnect() {
    $('sp-connect-card').hidden = status.connected;
    $('sp-main').hidden = !status.connected;
    if (status.connected) return;
    $('sp-card-title').textContent = status.hasClient ? 'Connect Spotify' : 'Set up Spotify';
    $('sp-card-sub').textContent = status.hasClient ? 'Sign in with your browser to control playback, like songs and pick playlists from the island.'
      : 'Add your Spotify Client ID in Settings first. It takes a minute: create an app at developer.spotify.com/dashboard.';
    $('sp-card-btn').textContent = status.hasClient ? 'Connect' : 'Open Settings';
  }
  $('sp-card-btn').addEventListener('click', async () => {
    if (!status.hasClient) { window.Panel.showTab('settings'); return; }
    const r = await window.islet.spotifyConnect();
    foot(r.ok ? 'Finish signing in in your browser…' : r.message, !r.ok);
  });
  window.islet.onSpotifyChanged(async () => { await refreshStatus(); if (status.connected) { poll(); loadPlaylists(true); } else { st = null; render(); } });

  /* ---------- now playing ---------- */
  async function poll() {
    if (!status.connected || polling) return;
    polling = true;
    const r = await window.islet.spotifyState();
    polling = false; lastPoll = Date.now();
    if (r.ok) { st = r.state; stAt = performance.now(); foot(''); render(); } else handleError(r);
  }
  let shownArt = '';
  function render() {
    const active = !!(st && st.active && st.track);
    $('sp-main').classList.toggle('idle', !active);
    const t = active ? st.track : null;
    $('sp-title').textContent = t ? t.name : 'Nothing playing';
    $('sp-artist').textContent = t ? [t.artists, t.album].filter(Boolean).join(' · ') : 'Open Spotify on a device and press play';
    const art = $('sp-art');
    if ((t ? t.art : '') !== shownArt) { shownArt = t ? t.art : ''; art.src = shownArt; art.style.visibility = shownArt ? 'visible' : 'hidden'; }
    $('sp-play').classList.toggle('playing', !!(active && st.playing));
    $('sp-like').classList.toggle('liked', !!(t && t.liked));
    $('sp-like').style.visibility = t && t.kind === 'track' ? 'visible' : 'hidden';
    $('sp-shuffle').classList.toggle('on', !!(active && st.shuffle));
    $('sp-repeat').classList.toggle('on', !!(active && st.repeat !== 'off'));
    $('sp-repeat').title = active ? `Repeat: ${st.repeat}` : 'Repeat';
    const vol = $('sp-volume');
    vol.disabled = !(active && st.device && st.device.supportsVolume);
    if (active && st.device && st.device.volume != null && !draggingVolume) { vol.value = st.device.volume; vol.style.setProperty('--p', `${st.device.volume}%`); }
    $('sp-device').textContent = active && st.device ? st.device.name : 'No device';
    tickProgress();
  }
  function tickProgress() {
    const t = st && st.active && st.track;
    const pos = t ? Math.min(t.duration, st.progress + (st.playing ? performance.now() - stAt : 0)) : 0;
    $('sp-pos').textContent = fmt(pos); $('sp-dur').textContent = fmt(t ? t.duration : 0);
    $('sp-fill').style.width = t && t.duration ? `${(pos / t.duration) * 100}%` : '0%';
  }

  async function cmd(name, arg) {
    const r = await window.islet.spotifyCmd(name, arg);
    if (!r.ok) handleError(r); else foot('');
    setTimeout(poll, 350);
  }
  $('sp-play').addEventListener('click', () => { if (st && st.active) { st.progress += st.playing ? performance.now() - stAt : 0; stAt = performance.now(); st.playing = !st.playing; render(); } cmd(st && st.playing ? 'play' : 'pause'); });
  $('sp-prev').addEventListener('click', () => cmd('prev'));
  $('sp-next').addEventListener('click', () => cmd('next'));
  $('sp-shuffle').addEventListener('click', () => { const on = !(st && st.shuffle); if (st) { st.shuffle = on; render(); } cmd('shuffle', on); });
  $('sp-repeat').addEventListener('click', () => { const next = { off: 'context', context: 'track', track: 'off' }[(st && st.repeat) || 'off']; if (st) { st.repeat = next; render(); } cmd('repeat', next); });
  $('sp-like').addEventListener('click', () => {
    const t = st && st.track; if (!t) return;
    t.liked = !t.liked; render(); cmd('like', { id: t.id, on: t.liked });
  });
  $('sp-seek').addEventListener('click', (e) => {
    const t = st && st.track; if (!t) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ms = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * t.duration);
    st.progress = ms; stAt = performance.now(); render(); cmd('seek', ms);
  });
  const vol = $('sp-volume');
  let volTimer = 0;
  vol.addEventListener('input', () => { draggingVolume = true; vol.style.setProperty('--p', `${vol.value}%`); clearTimeout(volTimer); volTimer = setTimeout(() => cmd('volume', Number(vol.value)), 180); });
  vol.addEventListener('change', () => { clearTimeout(volTimer); cmd('volume', Number(vol.value)); setTimeout(() => { draggingVolume = false; }, 600); });

  /* ---------- devices ---------- */
  const menu = $('sp-devices');
  $('sp-device').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!menu.hidden) { menu.hidden = true; return; }
    menu.replaceChildren(el('div', 'none', 'Looking for devices…')); menu.hidden = false;
    const r = await window.islet.spotifyDevices();
    menu.replaceChildren();
    if (!r.ok) { menu.append(el('div', 'none', r.message || 'Couldn’t load devices')); return; }
    if (!r.items.length) { menu.append(el('div', 'none', 'No devices found. Open Spotify on one.')); return; }
    for (const d of r.items) {
      const b = el('button', d.active ? 'on' : '');
      b.append(el('span', '', d.name), el('span', 'dim', d.active ? '✓' : d.type));
      b.addEventListener('click', () => { menu.hidden = true; cmd('transfer', d.id); });
      menu.append(b);
    }
  });
  document.addEventListener('click', () => { menu.hidden = true; });

  /* ---------- playlists ---------- */
  async function loadPlaylists(force) {
    if (!status.connected || (!force && playlists && Date.now() - playlistsAt < 5 * 60000)) return;
    const r = await window.islet.spotifyPlaylists();
    if (!r.ok) { if (!playlists) handleError(r); return; }
    playlists = r.items; playlistsAt = Date.now();
    const strip = $('sp-playlists'); strip.replaceChildren();
    if (!playlists.length) { strip.append(el('div', 'dim', 'No playlists yet')); return; }
    for (const p of playlists) {
      const b = el('button', 'pl'); b.title = p.name;
      if (p.image) { const i = el('img'); i.src = p.image; i.alt = ''; i.draggable = false; i.addEventListener('error', () => i.replaceWith(el('div', 'ph'))); b.append(i); }
      else { const ph = el('div', 'ph'); ph.innerHTML = ''; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-spotify'); svg.append(u); ph.append(svg); b.append(ph); }
      b.append(el('span', '', p.name));
      b.addEventListener('click', () => { foot(`Playing ${p.name}…`); cmd('playContext', p.uri); });
      strip.append(b);
    }
  }
  $('sp-refresh').addEventListener('click', () => { poll(); loadPlaylists(true); });

  /* ---------- Settings controls ---------- */
  const client = $('set-spClient');
  window.Panel.wireInput(client);
  const saveClient = () => { window.islet.updateSettings({ spotifyClientId: client.value.trim() }); client.blur(); };
  $('set-spSave').addEventListener('click', saveClient);
  client.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveClient(); });
  $('sp-connect').addEventListener('click', async () => {
    if (client.value.trim()) { window.islet.updateSettings({ spotifyClientId: client.value.trim() }); await new Promise((r) => setTimeout(r, 250)); }
    const r = await window.islet.spotifyConnect();
    const s = $('sp-set-status'); s.classList.toggle('err', !r.ok); s.textContent = r.ok ? 'Finish in your browser…' : r.message;
  });
  $('sp-disconnect').addEventListener('click', async () => { await window.islet.spotifyDisconnect(); st = null; playlists = null; refreshStatus(); render(); });
  function renderSettings() {
    const s = $('sp-set-status');
    s.classList.toggle('ok', status.connected); s.classList.remove('err');
    s.textContent = status.connected ? '✓ Connected' : status.hasClient ? 'Ready to connect' : 'Not set up';
    $('sp-connect').hidden = status.connected; $('sp-disconnect').hidden = !status.connected;
    $('set-spSave').hidden = status.connected;
    if (status.redirectUri) $('sp-redirect').textContent = status.redirectUri;
  }

  /* ---------- registration ---------- */
  window.Panel.register('spotify', {
    show() { refreshStatus().then(() => { if (status.connected) { poll(); loadPlaylists(); } }); },
    tick() { if (status.connected && Date.now() - lastPoll > 3000) poll(); tickProgress(); },
  });
  window.Panel.register('settings', { show: refreshStatus });
  window.Panel.register('*', { onSettings(s) { if (document.activeElement !== client) client.value = s.spotifyClientId || ''; refreshStatus(); } });
  refreshStatus();
})();
