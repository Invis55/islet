// First-run setup. Every step is optional; choices are saved as you make them.
// Steps are shown in sequence; the sports steps only appear when Sports is switched on.
// All text from the network is set with textContent only.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const clear = (n) => n.replaceChildren();
  const api = window.islet;

  const LEAGUES = [['eng.1', 'Premier League'], ['esp.1', 'La Liga'], ['ita.1', 'Serie A'], ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'],
    ['uefa.champions', 'Champions League'], ['uefa.europa', 'Europa League'], ['usa.1', 'MLS'], ['sau.1', 'Saudi Pro League']];
  const TEAM_COLORS = [[/red bull/i, '#3671C6'], [/ferrari/i, '#E8002D'], [/mercedes/i, '#27F4D2'], [/mclaren/i, '#FF8000'], [/aston/i, '#229971'], [/alpine/i, '#FF87BC'],
    [/williams/i, '#64C4FF'], [/\brb\b|racing bulls|alphatauri|toro/i, '#6692FF'], [/haas/i, '#B6BABD'], [/sauber|audi|alfa/i, '#52E252'], [/cadillac/i, '#C0C0C8']];
  const teamColor = (n) => (TEAM_COLORS.find(([re]) => re.test(n || '')) || [0, '#888'])[1];

  // step ids (the data-step attributes) in the order they appear
  const SPORTS_SEQ = [0, 6, 1, 2, 7, 3, 4, 5];
  const NO_SPORTS_SEQ = [0, 6, 3, 4, 5];
  const seq = () => (settings.modules && settings.modules.sports === false ? NO_SPORTS_SEQ : SPORTS_SEQ);

  let step = 0;
  let settings = { favTeams: [], favDrivers: [], favConstructor: '', nbaTeams: [], modules: { sports: false, focus: true, tasks: true } };
  let league = 'eng.1';
  const fbData = {};
  let f1Data = null;
  let nbaData = null;
  let spStatus = { hasClient: false, connected: false, redirectUri: '' };
  let ccConnected = false;

  /* ---------- navigation ---------- */
  function show(n) {
    const order = seq();
    step = Math.max(0, Math.min(order.length - 1, n));
    const id = order[step];
    document.querySelectorAll('.ob-step').forEach((s) => s.classList.toggle('on', Number(s.dataset.step) === id));
    const dots = $('dots'); clear(dots);
    for (let i = 0; i < order.length; i++) dots.append(el('i', i === step ? 'on' : i < step ? 'done' : ''));
    const last = step === order.length - 1;
    $('ob-back').hidden = step === 0;
    $('ob-skip').hidden = last;
    $('ob-next').textContent = step === 0 ? 'Get started' : last ? 'Start using Islet' : 'Continue';
    if (id === 1) { buildLeagues(); loadFootball(); }
    if (id === 2) loadF1();
    if (id === 7) loadNba();
    if (id === 3) refreshSpotify();
    if (id === 4) { refreshClaude(); syncSwitches(); }
    if (id === 5) renderSummary();
    if (id === 6) syncModules();
  }
  $('ob-next').addEventListener('click', () => { if (step === seq().length - 1) api.onboardingDone(); else show(step + 1); });
  $('ob-back').addEventListener('click', () => show(step - 1));
  $('ob-skip').addEventListener('click', () => api.onboardingDone());
  $('ob-close').addEventListener('click', () => api.closeWindow());

  /* ---------- what do you want ---------- */
  function syncModules() {
    const m = settings.modules || {};
    document.querySelectorAll('.mod[data-mod]').forEach((b) => b.classList.toggle('on', m[b.dataset.mod] !== false));
  }
  document.querySelectorAll('.mod[data-mod]').forEach((b) => b.addEventListener('click', () => {
    const name = b.dataset.mod;
    const on = !(settings.modules && settings.modules[name] !== false);
    settings = { ...settings, modules: { ...settings.modules, [name]: on } };
    b.classList.toggle('on', on);
    api.updateSettings({ modules: { [name]: on } });
  }));

  /* ---------- football ---------- */
  function buildLeagues() {
    const box = $('ob-leagues'); clear(box);
    for (const [id, name] of LEAGUES) {
      const b = el('button', id === league ? 'on' : '', name);
      b.addEventListener('click', () => { league = id; buildLeagues(); renderTeams(); loadFootball(); });
      box.append(b);
    }
  }
  async function loadFootball(force) {
    const have = fbData[league];
    if (!force && have && Date.now() - have.at < 60000) { renderTeams(); return; }
    if (!have) { const t = $('ob-teams'); clear(t); t.append(el('div', 'empty-ob', 'Loading teams…')); }
    const mine = league;
    const r = await api.getFootball(mine);
    fbData[mine] = { ...r, at: Date.now() };
    if (mine === league) renderTeams();
  }
  function renderTeams() {
    const box = $('ob-teams'); clear(box);
    const d = fbData[league];
    const rows = d ? d.table.flatMap((g) => g.rows) : [];
    if (!rows.length) { box.append(el('div', 'empty-ob', d ? (d.error ? 'Couldn’t load teams. Check your connection, then pick the league again.' : 'No table for this competition yet.') : 'Loading teams…')); return; }
    for (const r of rows) {
      const b = el('button', 'tile' + (r.fav ? ' on' : ''));
      const img = el('img', 'crest'); if (r.logo) img.src = r.logo; img.alt = ''; img.draggable = false; img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      b.append(img, el('span', 'nm', r.name), el('span', 'check', '✓'));
      b.addEventListener('click', () => api.updateSettings({ toggleFavTeam: { league, id: r.id, src: r.src, name: r.name, full: r.full, abbr: r.abbr, logo: r.logo } }));
      box.append(b);
    }
  }
  const key = $('ob-afkey');
  const saveKey = () => { if (key.value.trim()) { api.updateSettings({ apiFootballKey: key.value.trim() }); key.value = ''; } };
  $('ob-afsave').addEventListener('click', saveKey);
  key.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });
  $('ob-aflink').addEventListener('click', () => api.openLink('https://www.api-football.com/'));

  /* ---------- F1 ---------- */
  async function loadF1(force) {
    if (!force && f1Data) { renderF1(); return; }
    clear($('ob-drivers')); $('ob-drivers').append(el('div', 'empty-ob', 'Loading drivers…'));
    f1Data = await api.getF1();
    renderF1();
  }
  function renderF1() {
    const pills = $('ob-teams-f1'); clear(pills);
    const teams = (f1Data && f1Data.teams && f1Data.teams.rows) || [];
    for (const t of teams) {
      const b = el('button', settings.favConstructor === t.name ? 'on' : '', t.name);
      b.addEventListener('click', () => api.updateSettings({ favConstructor: t.name }));
      pills.append(b);
    }
    const box = $('ob-drivers'); clear(box);
    const rows = (f1Data && f1Data.drivers && f1Data.drivers.rows) || [];
    if (!rows.length) { box.append(el('div', 'empty-ob', f1Data && f1Data.error ? 'Couldn’t load drivers. Check your connection.' : 'No driver standings yet this season.')); return; }
    for (const d of rows) {
      const on = settings.favDrivers.includes(d.code);
      const b = el('button', 'tile drv' + (on ? ' on' : '')); b.style.setProperty('--tag', teamColor(d.team));
      b.append(el('span', 'code', d.code), el('span', 'nm', d.name), el('span', 'sub', d.team), el('span', 'check', '✓'));
      b.addEventListener('click', () => api.updateSettings({ toggleFavDriver: d.code }));
      box.append(b);
    }
  }

  /* ---------- NBA ---------- */
  async function loadNba() {
    const box = $('ob-nba'); clear(box);
    box.append(el('div', 'empty-ob', 'Loading teams…'));
    try { nbaData = await api.nbaGet(); } catch { nbaData = { groups: [], error: 'offline' }; }
    renderNba();
  }
  function renderNba() {
    const box = $('ob-nba'); clear(box);
    const rows = nbaData && nbaData.groups ? nbaData.groups.flatMap((g) => g.rows) : [];
    if (!rows.length) { box.append(el('div', 'empty-ob', 'Couldn’t load teams yet. You can pick them later in the NBA tab.')); return; }
    const mine = new Set((settings.nbaTeams || []).map((t) => t.id));
    for (const r of rows) {
      const b = el('button', 'tile' + (mine.has(r.id) ? ' on' : ''));
      const img = el('img', 'crest'); if (r.logo) img.src = r.logo; img.alt = ''; img.draggable = false; img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      b.append(img, el('span', 'nm', r.full || r.name), el('span', 'check', '✓'));
      b.addEventListener('click', () => api.updateSettings({ toggleNbaTeam: { id: r.id, name: r.name, full: r.full, abbr: r.abbr, logo: r.logo } }));
      box.append(b);
    }
  }

  /* ---------- Spotify ---------- */
  async function refreshSpotify() {
    spStatus = await api.spotifyStatus();
    $('ob-redirect').textContent = spStatus.redirectUri || $('ob-redirect').textContent;
    const s = $('ob-spstatus');
    s.className = 'status-line' + (spStatus.connected ? ' ok' : '');
    s.textContent = spStatus.connected ? '✓ Spotify is connected' : '';
    $('ob-spconnect').textContent = spStatus.connected ? 'Reconnect' : 'Connect';
    if (settings.spotifyClientId && document.activeElement !== $('ob-spclient')) $('ob-spclient').value = settings.spotifyClientId;
  }
  $('ob-spdash').addEventListener('click', () => api.openLink('https://developer.spotify.com/dashboard'));
  $('ob-copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText($('ob-redirect').textContent); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; }
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1600);
  });
  $('ob-spconnect').addEventListener('click', async () => {
    const id = $('ob-spclient').value.trim();
    if (id) { api.updateSettings({ spotifyClientId: id }); await new Promise((r) => setTimeout(r, 300)); }
    const r = await api.spotifyConnect();
    const s = $('ob-spstatus');
    s.className = 'status-line' + (r.ok ? '' : ' err');
    s.textContent = r.ok ? 'Finish signing in in your browser, then come back here…' : r.message;
  });
  api.onSpotifyChanged(() => refreshSpotify());

  /* ---------- calendar, Claude, switches ---------- */
  $('ob-icssave').addEventListener('click', (e) => { api.updateSettings({ icsUrl: $('ob-ics').value.trim() }); e.target.textContent = 'Saved'; setTimeout(() => { e.target.textContent = 'Save'; }, 1400); });
  async function refreshClaude() {
    const st = await api.claudeStatus();
    ccConnected = !!st.connected;
    const s = $('ob-ccstatus'); s.textContent = st.error ? 'Unavailable' : ccConnected ? '✓ Connected' : 'Not connected'; s.classList.toggle('ok', ccConnected);
    $('ob-ccconnect').hidden = ccConnected;
  }
  $('ob-ccconnect').addEventListener('click', async () => { await api.claudeConnect(); refreshClaude(); });
  function syncSwitches() {
    $('ob-alerts').checked = settings.footballAlerts !== false && settings.f1Alerts !== false;
    $('ob-notch').checked = settings.notch !== false;
    $('ob-autostart').checked = !!settings.autostart;
    if (settings.icsUrl && document.activeElement !== $('ob-ics')) $('ob-ics').value = settings.icsUrl;
  }
  $('ob-alerts').addEventListener('change', (e) => api.updateSettings({ footballAlerts: e.target.checked, f1Alerts: e.target.checked }));
  $('ob-notch').addEventListener('change', (e) => api.updateSettings({ notch: e.target.checked }));
  $('ob-autostart').addEventListener('change', (e) => api.updateSettings({ autostart: e.target.checked }));

  /* ---------- summary ---------- */
  function sumRow(icon, title, detail, on) {
    const r = el('div', 'sum' + (on ? '' : ' off'));
    const i = el('div', 'fi glass'); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `#${icon}`); svg.append(u); i.append(svg);
    const t = el('div'); t.append(el('b', '', title), document.createTextNode(' '), el('span', '', detail));
    r.append(i, t);
    return r;
  }
  function renderSummary() {
    const box = $('ob-summary'); clear(box);
    const m = settings.modules || {};
    if (m.sports !== false) {
      const teams = settings.favTeams || [];
      box.append(sumRow('i-ball', 'Football', teams.length ? teams.map((t) => t.name).join(', ') : 'No teams followed. Add some anytime from the Football tab.', teams.length > 0));
      const drivers = settings.favDrivers || [];
      box.append(sumRow('i-flag', 'Formula 1', drivers.length || settings.favConstructor ? [...drivers, settings.favConstructor].filter(Boolean).join(', ') : 'Race countdowns and standings, no favourites picked.', !!(drivers.length || settings.favConstructor)));
      const nba = settings.nbaTeams || [];
      box.append(sumRow('i-hoop', 'NBA', nba.length ? nba.map((t) => t.name).join(', ') : 'Scores and standings. Pick teams anytime in the NBA tab.', nba.length > 0));
    }
    if (m.focus !== false) box.append(sumRow('i-timer', 'Focus timer', 'Work and break blocks, with a pill on the island', true));
    if (m.tasks !== false) box.append(sumRow('i-check', 'Tasks', 'A checklist for today', true));
    box.append(sumRow('i-spotify', 'Spotify', spStatus.connected ? 'Connected' : 'Not connected. You can do it later in Settings.', spStatus.connected));
    box.append(sumRow('i-calendar', 'Calendar', settings.icsUrl ? 'Linked' : 'Not linked. Add a link in Settings for meetings and Join buttons.', !!settings.icsUrl));
    box.append(sumRow('i-spark', 'Claude Code', ccConnected ? 'Connected' : 'Not connected', ccConnected));
  }

  /* ---------- live settings ---------- */
  api.onSettings((s) => {
    settings = { favTeams: [], favDrivers: [], favConstructor: '', nbaTeams: [], ...s, modules: { sports: false, focus: true, tasks: true, ...(s.modules || {}) } };
    for (const k of Object.keys(fbData)) delete fbData[k].at; // re-annotate (served from the app's cache, no extra API calls)
    const id = seq()[step];
    if (id === 1) { renderTeams(); loadFootball(true); $('ob-afstatus').textContent = settings.apiFootballKeySet ? `Key saved (…${settings.apiFootballKeyTail}).` : ''; }
    if (id === 2 && f1Data) renderF1();
    if (id === 7) renderNba();
    if (id === 3) refreshSpotify();
    if (id === 4) syncSwitches();
    if (id === 5) renderSummary();
    if (id === 6) syncModules();
  });

  show(0);
})();
