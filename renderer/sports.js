// Football + Formula 1 tabs, the Now-tab sports chips, and the Claude Code connect controls in Settings.
// All text from the network is set with textContent only.
(() => {
  const $ = (id) => document.getElementById(id);
  const { el } = window.Panel;
  const DAY = 86400000;
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hm = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayName = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const clear = (n) => n.replaceChildren();

  const LEAGUES = [
    ['eng.1', 'PL'], ['esp.1', 'La Liga'], ['ita.1', 'Serie A'], ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'],
    ['uefa.champions', 'UCL'], ['uefa.europa', 'UEL'], ['usa.1', 'MLS'], ['sau.1', 'SPL'],
  ];

  let settings = window.UI.settings;
  let summary = { fav: null, f1: null, f1fav: null };
  const favKey = (s) => JSON.stringify([s.favTeams || [], s.favDrivers || [], s.favConstructor || '']);

  function until(ts) {
    const ms = ts - Date.now();
    if (ms < 0) return 'now';
    const m = Math.round(ms / 60000);
    if (m < 60) return `in ${Math.max(m, 1)} min`;
    if (m < 24 * 60) return `in ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
    return `${new Date(ts).toLocaleDateString([], { weekday: 'short' })} ${hm(ts)}`;
  }

  /* ================= football ================= */
  const fb = { league: settings.footballLeague || 'eng.1', view: 'fixtures', data: {}, scrolled: {}, loading: false, timer: 0 };

  function buildLeaguePills() {
    const box = $('fb-leagues');
    clear(box);
    for (const [id, label] of LEAGUES) {
      const b = el('button', id === fb.league ? 'on' : '', label);
      b.addEventListener('click', () => { fb.league = id; window.islet.updateSettings({ footballLeague: id }); buildLeaguePills(); renderFootball(); loadFootball(); });
      box.append(b);
    }
  }
  // vertical wheel scrolls the league pills sideways
  $('fb-leagues').addEventListener('wheel', (e) => { e.currentTarget.scrollLeft += e.deltaY; });

  document.querySelectorAll('[data-fbview]').forEach((b) => b.addEventListener('click', () => {
    fb.view = b.dataset.fbview;
    document.querySelectorAll('[data-fbview]').forEach((x) => x.classList.toggle('on', x === b));
    renderFootball();
  }));

  async function loadFootball(force) {
    const league = fb.league;
    const have = fb.data[league];
    if (!force && have && Date.now() - have.loadedAt < 45000) return;
    fb.loading = true; renderStatus();
    const res = await window.islet.getFootball(league);
    fb.loading = false;
    fb.data[league] = { ...res, loadedAt: Date.now() };
    if (fb.league === league) renderFootball();
  }


  function crest(src) {
    const i = el('img', 'crest');
    if (src) i.src = src; else i.style.visibility = 'hidden';
    i.alt = ''; i.draggable = false;
    i.addEventListener('error', () => { i.style.visibility = 'hidden'; });
    return i;
  }

  function renderStatus() {
    const d = fb.data[fb.league];
    const st = $('fb-status');
    const n = (settings.favTeams || []).length;
    const warn = d && (d.error || (d.quota && d.quota.note));
    st.classList.toggle('err', !!warn);
    if (fb.loading && !d) st.textContent = 'Loading…';
    else if (d && d.error) st.textContent = `Couldn’t load everything: ${d.error}`;
    else if (d && d.quota && d.quota.note) st.textContent = `${d.quota.note}. Showing ${d.source}.`;
    else {
      const bits = [];
      if (n) bits.push(`★ Following ${n} team${n === 1 ? '' : 's'}`);
      else bits.push(fb.view === 'table' ? 'Tap ☆ to follow teams' : 'Follow teams from the Table');
      if (d && d.source) bits.push(d.quota && d.quota.remaining != null && d.src === 'af' ? `${d.source} · ${d.quota.remaining} requests left today` : d.source);
      st.textContent = bits.join('  ·  ');
    }
    $('fb-unfollow').hidden = !n;
  }

  function renderFootball() {
    const list = $('fb-list');
    const d = fb.data[fb.league];
    const prevScroll = list.scrollTop;
    clear(list);
    renderStatus();
    if (!d) { list.append(el('div', 'empty', 'Loading…')); return; }
    if (d.error && !d.fixtures.length && !d.table.length) { list.append(el('div', 'empty', 'No data yet. Check your connection and press the league again.')); return; }
    const anchored = fb.view === 'fixtures' ? renderFixtures(list, d) : (renderTable(list, d), false);
    if (!anchored) list.scrollTop = prevScroll; // keep the user's place on refresh, except the first time we jump to today
  }

  function renderFixtures(list, d) {
    if (!d.fixtures.length) { list.append(el('div', 'empty', 'No matches in the last 3 days or the next week.')); return false; }
    const today = startOfDay(Date.now());
    let lastDay = null, anchor = null;
    for (const m of d.fixtures) {
      const day = startOfDay(m.date);
      if (day !== lastDay) {
        lastDay = day;
        const diff = Math.round((day - today) / DAY);
        const h = el('div', 'day', diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : dayName(day));
        list.append(h);
        if (!anchor && diff >= 0) anchor = h;
      }
      const row = el('div', 'fx' + (m.favSide ? ' fav' : '') + (m.state === 'post' ? ' done' : ''));
      const t = el('span', 'fx-time' + (m.state === 'in' ? ' live' : ''), m.state === 'pre' ? hm(m.date) : m.label);
      const home = el('div', 'fx-team home' + (m.favSide === 'home' ? ' mine' : ''));
      home.append(el('span', '', m.home.name), crest(m.home.logo));
      const away = el('div', 'fx-team away' + (m.favSide === 'away' ? ' mine' : ''));
      away.append(crest(m.away.logo), el('span', '', m.away.name));
      const hasScore = m.state === 'in' || m.state === 'post';
      const score = el('div', 'fx-score' + (hasScore ? '' : ' v'), hasScore ? `${m.home.score ?? 0} – ${m.away.score ?? 0}` : 'v');
      row.append(t, home, score, away);
      list.append(row);
    }
    if (!fb.scrolled[fb.league] && anchor) { fb.scrolled[fb.league] = true; list.scrollTop = anchor.offsetTop - list.offsetTop - 4; return true; }
    return false;
  }

  function renderTable(list, d) {
    if (!d.table.length) { list.append(el('div', 'empty', 'No table available for this competition yet.')); return; }
    for (const g of d.table) {
      if (g.name && d.table.length > 1) list.append(el('div', 'grp', g.name));
      const t = el('table', 'tbl');
      const head = el('tr');
      [['#', 'l'], ['Team', 'l'], ['P'], ['W'], ['D'], ['L'], ['GD'], ['Pts'], ['']].forEach(([h, c]) => head.append(el('th', c || '', h)));
      t.append(head);
      for (const r of g.rows) {
        const tr = el('tr', r.fav ? 'fav' : '');
        tr.append(el('td', 'rk l', String(r.rank)));
        const tm = el('td', 'l');
        const wrap = el('div', 'tm'); wrap.append(crest(r.logo), el('span', '', r.name)); tm.append(wrap);
        tr.append(tm, el('td', '', String(r.played)), el('td', '', String(r.w)), el('td', '', String(r.d)), el('td', '', String(r.l)),
          el('td', '', (r.gd > 0 ? '+' : '') + r.gd), el('td', 'pts', String(r.pts)));
        const starTd = el('td');
        const star = el('button', 'star' + (r.fav ? ' on' : ''), r.fav ? '★' : '☆');
        star.title = r.fav ? 'Unfollow' : 'Follow for alerts';
        star.addEventListener('click', () => window.islet.updateSettings({
          toggleFavTeam: { league: fb.league, id: r.id, src: r.src, name: r.name, full: r.full, abbr: r.abbr, logo: r.logo },
        }));
        starTd.append(star); tr.append(starTd);
        t.append(tr);
      }
      list.append(t);
    }
  }
  $('fb-unfollow').addEventListener('click', () => window.islet.updateSettings({ clearFavTeams: true }));

  /* ================= Formula 1 ================= */
  const f1 = { view: 'schedule', data: null, loading: false };
  const TEAM_COLORS = [
    [/red bull/i, '#3671C6'], [/ferrari/i, '#E8002D'], [/mercedes/i, '#27F4D2'], [/mclaren/i, '#FF8000'], [/aston/i, '#229971'],
    [/alpine/i, '#FF87BC'], [/williams/i, '#64C4FF'], [/\brb\b|racing bulls|alphatauri|toro/i, '#6692FF'], [/haas/i, '#B6BABD'],
    [/sauber|audi|alfa/i, '#52E252'], [/cadillac/i, '#C0C0C8'],
  ];
  const teamColor = (name) => (TEAM_COLORS.find(([re]) => re.test(name || '')) || [0, '#888'])[1];

  document.querySelectorAll('[data-f1view]').forEach((b) => b.addEventListener('click', () => {
    f1.view = b.dataset.f1view;
    document.querySelectorAll('[data-f1view]').forEach((x) => x.classList.toggle('on', x === b));
    renderF1();
  }));
  $('f1-refresh').addEventListener('click', () => loadF1(true));

  async function loadF1(force) {
    if (!force && f1.data && Date.now() - f1.data.loadedAt < 60000) return;
    f1.loading = true; renderF1Status();
    f1.data = { ...(await window.islet.getF1()), loadedAt: Date.now() };
    f1.loading = false;
    renderF1();
  }

  function renderF1Status() {
    const d = f1.data, st = $('f1-status');
    st.classList.toggle('err', !!(d && d.error));
    st.textContent = f1.loading && !d ? 'Loading…' : d && d.error ? `Couldn’t load everything: ${d.error}` : d ? `Updated ${hm(d.updated)}` : '';
    const season = d && d.drivers && d.drivers.season;
    $('f1-season').textContent = season ? `${season} season` : '';
  }

  function countdown(ms) {
    if (ms <= 0) return 'Lights out!';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return d > 0 ? `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function nextRaceOf(races) { return races.find((r) => (r.start || 0) + 3 * 3600000 > Date.now()) || null; }

  function renderF1() {
    renderF1Status();
    const list = $('f1-list');
    clear(list);
    const d = f1.data;
    if (!d) { list.append(el('div', 'empty', 'Loading…')); return; }
    if (d.error && !d.races.length && !d.drivers.rows.length) { list.append(el('div', 'empty', 'No data yet. Check your connection and press Refresh.')); return; }
    ({ schedule: renderSchedule, drivers: renderDrivers, teams: renderTeams, last: renderLast })[f1.view](list, d);
  }

  function renderSchedule(list, d) {
    const nxt = nextRaceOf(d.races);
    if (!nxt) { list.append(el('div', 'empty', d.races.length ? 'That’s the season done. See you next year! 🏁' : 'No calendar available yet.')); return; }
    const card = el('div', 'race-card');
    const top = el('div', 'rc-top');
    const left = el('div');
    const rr = el('div', 'rc-round', `Round ${nxt.round}`);
    if (nxt.sprint) rr.append(el('span', 'badge-sprint', 'SPRINT'));
    left.append(rr, el('div', 'rc-name', nxt.name), el('div', 'rc-circuit', [nxt.circuit, nxt.locality, nxt.country].filter(Boolean).join(' · ')));
    const count = el('div', 'rc-count', countdown(nxt.start - Date.now()));
    count.id = 'f1-count'; count.dataset.target = String(nxt.start);
    top.append(left, count);
    card.append(top);
    const sess = el('div', 'sessions');
    const upcoming = nxt.sessions.find((s) => s.start > Date.now());
    for (const s of nxt.sessions) {
      const row = el('div', 'sess' + (s.start <= Date.now() ? ' past' : upcoming && s === upcoming ? ' next' : ''));
      row.append(el('span', 'n', s.label), el('span', 't', `${new Date(s.start).toLocaleDateString([], { weekday: 'short' })} ${hm(s.start)}`));
      sess.append(row);
    }
    card.append(sess);
    list.append(card);
    const later = d.races.filter((r) => r.round > nxt.round);
    if (later.length) list.append(el('div', 'day', 'Coming up'));
    for (const r of later) {
      const row = el('div', 'rrow');
      row.append(el('span', 'r', `R${r.round}`), el('span', '', r.name), el('span', 'd', r.start ? dayName(r.start) : ''));
      list.append(row);
    }
    const done = d.races.filter((r) => r.round < nxt.round).length;
    if (done) { const n = el('div', 'dim', `${done} race${done === 1 ? '' : 's'} completed`); n.style.padding = '8px 4px'; list.append(n); }
  }

  function standingsRows(list, rows, mk) {
    if (!rows.length) { list.append(el('div', 'empty', 'No standings yet this season.')); return; }
    const max = Math.max(1, ...rows.map((r) => r.points));
    for (const r of rows) list.append(mk(r, (r.points / max) * 100));
  }

  const favDriver = (code) => (settings.favDrivers || []).includes(code);
  function starButton(on, onClick) {
    const b = el('button', 'star' + (on ? ' on' : ''), on ? '★' : '☆');
    b.title = on ? 'Unfollow' : 'Follow';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderDrivers(list, d) {
    standingsRows(list, d.drivers.rows, (r, pct) => {
      const row = el('div', 'drow' + (favDriver(r.code) ? ' fav' : ''));
      const fill = el('div', 'fill'); fill.style.width = `${pct}%`;
      const tag = el('span', 'tag'); tag.style.background = teamColor(r.team);
      const nm = el('span', 'nm', r.name); nm.append(el('small', '', r.team));
      row.append(fill, el('span', 'p', String(r.pos)), tag, el('span', 'code', r.code), nm, el('span', 'w', r.wins ? `${r.wins} win${r.wins === 1 ? '' : 's'}` : ''), el('span', 'pts', String(r.points)),
        starButton(favDriver(r.code), () => window.islet.updateSettings({ toggleFavDriver: r.code })));
      return row;
    });
  }
  function renderTeams(list, d) {
    standingsRows(list, d.teams.rows, (r, pct) => {
      const mine = settings.favConstructor === r.name;
      const row = el('div', 'drow' + (mine ? ' fav' : ''));
      const fill = el('div', 'fill'); fill.style.width = `${pct}%`;
      const tag = el('span', 'tag'); tag.style.background = teamColor(r.name);
      row.append(fill, el('span', 'p', String(r.pos)), tag, el('span', 'code', ''), el('span', 'nm', r.name), el('span', 'w', r.wins ? `${r.wins} win${r.wins === 1 ? '' : 's'}` : ''), el('span', 'pts', String(r.points)),
        starButton(mine, () => window.islet.updateSettings({ favConstructor: r.name })));
      return row;
    });
  }
  function renderLast(list, d) {
    const l = d.last;
    if (!l) { list.append(el('div', 'empty', 'No race results yet this season.')); return; }
    list.append(el('div', 'res-head', `${l.name} · Round ${l.round}`), el('div', 'res-sub', [l.circuit, l.date ? new Date(l.date).toLocaleDateString([], { day: 'numeric', month: 'long' }) : ''].filter(Boolean).join(' · ')));
    for (const r of l.results) {
      const row = el('div', 'drow' + (favDriver(r.code) ? ' fav' : ''));
      const tag = el('span', 'tag'); tag.style.background = teamColor(r.team);
      const nm = el('span', 'nm', r.name + (r.fastest ? '  ⏱' : '')); nm.append(el('small', '', r.team));
      const gap = r.time || r.status;
      row.append(el('span', 'p', String(r.pos)), tag, el('span', 'code', r.code), nm, el('span', 'rs-time', gap), el('span', 'pts', r.points ? `+${r.points}` : ''), el('span'));
      list.append(row);
    }
  }

  /* ================= Now-tab chips ================= */
  function favText(m) {
    const favs = settings.favTeams || [];
    if (!favs.length) return { text: 'Follow a team in the Football tab', live: false };
    if (!m) return { text: `${favs[0].name}${favs.length > 1 ? ` +${favs.length - 1}` : ''}: no match this week`, live: false };
    const line = `${m.home.abbr} ${m.home.score ?? 0}–${m.away.score ?? 0} ${m.away.abbr}`;
    if (m.state === 'in') return { text: `${line} · ${m.label}`, live: true };
    if (m.state === 'post') return { text: `FT · ${line}`, live: false };
    return { text: `${m.home.abbr} v ${m.away.abbr} · ${until(m.date)}`, live: false };
  }
  function renderChips() {
    const fav = favText(summary.fav);
    $('fav-text').textContent = fav.text;
    $('chip-fav').classList.toggle('live', fav.live);
    const s = summary.f1;
    const mine = summary.f1fav && summary.f1fav.drivers && summary.f1fav.drivers[0];
    const next = s ? `${s.race.replace(/ Grand Prix$/, ' GP')} · ${s.label} ${until(s.start)}` : 'F1: no upcoming session';
    $('f1-chip-text').textContent = mine ? `${mine.code} P${mine.pos} · ${next}` : next;
  }
  window.islet.onSummary((s) => { summary = s || { fav: null, f1: null, f1fav: null }; renderChips(); });
  $('chip-fav').addEventListener('click', () => window.Panel.showTab('football'));
  $('chip-f1').addEventListener('click', () => window.Panel.showTab('f1'));

  /* ================= Claude Code connect ================= */
  async function refreshClaude() {
    const st = await window.islet.claudeStatus();
    const s = $('cc-status');
    s.classList.toggle('ok', !!st.connected);
    s.textContent = st.error ? st.error : st.connected ? '✓ Connected' : 'Not connected';
    $('cc-connect').hidden = st.connected;
    $('cc-disconnect').hidden = !st.connected;
  }
  $('cc-connect').addEventListener('click', async () => {
    const r = await window.islet.claudeConnect();
    if (!r.ok && !r.cancelled) { $('cc-status').classList.remove('ok'); $('cc-status').textContent = r.message || 'Couldn’t connect'; return; }
    refreshClaude();
  });
  $('cc-disconnect').addEventListener('click', async () => { await window.islet.claudeDisconnect(); refreshClaude(); });

  /* ================= registration ================= */
  window.Panel.register('football', {
    show() { fb.timer = Date.now(); buildLeaguePills(); loadFootball(); },
    render() { renderFootball(); },
    tick() { const now = Date.now(); if (now - (fb.timer || 0) > 60000) { fb.timer = now; loadFootball(true); } },
  });
  window.Panel.register('f1', {
    show() { loadF1(); },
    render() { if (f1.data) renderF1(); },
    tick() {
      const c = document.getElementById('f1-count');
      if (c) c.textContent = countdown(Number(c.dataset.target) - Date.now());
    },
  });
  window.Panel.register('settings', { show: refreshClaude });
  window.Panel.register('*', {
    tick: renderChips,
    onSettings(s) {
      const changed = favKey(settings) !== favKey(s), keyChanged = settings.apiFootballKeySet !== s.apiFootballKeySet;
      settings = s;
      if (s.footballLeague && s.footballLeague !== fb.league) { fb.league = s.footballLeague; buildLeaguePills(); }
      for (const key of ['footballAlerts', 'f1Alerts']) $(`set-${key}`).checked = !!s[key];
      if (changed || keyChanged) { fb.data = {}; fb.scrolled = {}; } // re-annotate / re-source (served from the app's cache, no extra API calls)
      if (window.Panel.getTab() === 'football') { renderFootball(); loadFootball(true); }
      if (window.Panel.getTab() === 'f1' && f1.data) renderF1();
      if (document.activeElement !== $('set-afKey')) $('set-afKey').placeholder = s.apiFootballKeySet ? `Key saved (…${s.apiFootballKeyTail}). Paste a new one to replace` : 'API-Football key (optional)';
      $('af-status').textContent = s.apiFootballKeySet ? 'API-Football' : 'ESPN (no key needed)';
      $('af-status').classList.toggle('ok', !!s.apiFootballKeySet);
      renderChips();
    },
  });
  for (const key of ['footballAlerts', 'f1Alerts']) {
    $(`set-${key}`).addEventListener('change', (e) => window.islet.updateSettings({ [key]: e.target.checked }));
  }
  const afKey = $('set-afKey');
  window.Panel.wireInput(afKey);
  const saveKey = () => { if (afKey.value.trim() || afKey.value === '') window.islet.updateSettings({ apiFootballKey: afKey.value.trim() }); afKey.value = ''; afKey.blur(); };
  $('set-afSave').addEventListener('click', saveKey);
  afKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });
  $('af-link').addEventListener('click', () => window.islet.openLink('https://www.api-football.com/'));
  $('set-rerun').addEventListener('click', () => window.islet.openOnboarding());
  buildLeaguePills();
  renderChips();
})();
