// NBA page: today's games (your teams first), conference standings and a team picker.
// Team names and logos come from the network: textContent and src only.
(() => {
  const $ = (id) => document.getElementById(id);
  const { el } = window.Panel;
  const hm = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const nba = { view: 'today', data: null, loading: false, at: 0 };
  const favIds = () => ((window.UI && window.UI.settings && window.UI.settings.nbaTeams) || []).map((t) => t.id);
  const isMine = (id) => favIds().includes(id);

  function crest(src) {
    const i = el('img', 'crest');
    if (src) i.src = src; else i.style.visibility = 'hidden';
    i.alt = ''; i.draggable = false;
    i.addEventListener('error', () => { i.style.visibility = 'hidden'; });
    return i;
  }

  async function load(force) {
    if (nba.loading) return;
    if (!force && nba.data && Date.now() - nba.at < 45000) { render(); return; }
    nba.loading = true;
    try { nba.data = await window.islet.nbaGet(); nba.at = Date.now(); }
    catch (e) { nba.data = { games: [], groups: [], error: e.message || String(e) }; }
    nba.loading = false;
    render();
  }

  function renderGames(list, d) {
    const games = [...d.games].sort((a, b) => {
      const fa = isMine(a.home.id) || isMine(a.away.id), fb = isMine(b.home.id) || isMine(b.away.id);
      return fa !== fb ? (fa ? -1 : 1) : a.date - b.date;
    });
    if (!games.length) { list.append(el('div', 'empty', 'No games scheduled for today.')); return; }
    const mine = games.filter((g) => isMine(g.home.id) || isMine(g.away.id));
    if (mine.length) list.append(el('div', 'day', 'Your teams'));
    let shownRest = false;
    for (const g of games) {
      const fav = isMine(g.home.id) || isMine(g.away.id);
      if (!fav && !shownRest) {
        shownRest = true;
        list.append(el('div', 'day', mine.length ? 'Everything else' : 'Today'));
      }
      const row = el('div', 'fx nb-game' + (fav ? ' fav' : '') + (g.state === 'post' ? ' done' : ''));
      const live = g.state === 'in';
      const t = el('span', 'fx-time' + (live ? ' live' : ''), g.state === 'pre' ? hm(g.date) : g.label);
      const home = el('div', 'fx-team home' + (isMine(g.home.id) ? ' mine' : ''));
      home.append(el('span', '', g.home.name), crest(g.home.logo));
      const away = el('div', 'fx-team away' + (isMine(g.away.id) ? ' mine' : ''));
      away.append(crest(g.away.logo), el('span', '', g.away.name));
      const hasScore = g.state === 'in' || g.state === 'post';
      const score = el('div', 'fx-score' + (hasScore ? '' : ' v'), hasScore ? `${g.home.score ?? 0} – ${g.away.score ?? 0}` : 'v');
      row.append(t, home, score, away);
      list.append(row);
    }
  }

  function renderStandings(list, d) {
    if (!d.groups.length) { list.append(el('div', 'empty', 'Standings are not available yet.')); return; }
    for (const g of d.groups) {
      if (g.name) list.append(el('div', 'grp', g.name));
      for (const r of g.rows) {
        const row = el('div', 'nb-row' + (isMine(r.id) ? ' fav' : ''));
        const w = el('span', 'nb-wl', `${r.w}–${r.l}`);
        const gd = r.gd > 0 ? `+${r.gd}` : String(r.gd);
        row.append(el('span', 'nb-rank', String(r.rank)), crest(r.logo), el('span', 'nb-name', r.name), el('span', 'nb-gd dim', gd), w);
        list.append(row);
      }
    }
  }

  function renderTeams(list, d) {
    const teams = d.groups.flatMap((g) => g.rows);
    if (!teams.length) { list.append(el('div', 'empty', 'Teams appear once the season table is loaded.')); return; }
    const max = 5;
    const note = el('div', 'dim nb-note', `Follow up to ${max} teams. Their games appear first in Games.`);
    list.append(note);
    const grid = el('div', 'tiles');
    for (const r of teams) {
      const b = el('button', 'tile' + (isMine(r.id) ? ' on' : ''));
      b.append(crest(r.logo), el('span', 'nm', r.full), el('span', 'check', '✓'));
      b.addEventListener('click', () => window.islet.updateSettings({ toggleNbaTeam: { id: r.id, name: r.name, full: r.full, abbr: r.abbr, logo: r.logo } }));
      grid.append(b);
    }
    list.append(grid);
  }

  function render() {
    const list = $('nba-list');
    if (!list) return;
    list.replaceChildren();
    const d = nba.data;
    if (!d) { list.append(el('div', 'empty', 'Loading…')); return; }
    if (d.disabled) { list.append(el('div', 'empty', 'Sports are switched off. Turn them on in Settings → Features.')); return; }
    if (d.error && !d.games.length && !d.groups.length) { list.append(el('div', 'empty', 'No data yet. Check your connection, then press Refresh.')); return; }
    if (nba.view === 'today') renderGames(list, d);
    else if (nba.view === 'standings') renderStandings(list, d);
    else renderTeams(list, d);
    $('nba-status').textContent = d.error ? `Some data missing: ${d.error}` : d.updated ? `Updated ${hm(d.updated)}` : '';
    $('nba-status').classList.toggle('err', !!d.error);
    $('nba-season').textContent = nba.view === 'standings' ? 'Regular season' : '';
  }

  document.querySelectorAll('[data-nbaview]').forEach((b) => b.addEventListener('click', () => {
    nba.view = b.dataset.nbaview;
    document.querySelectorAll('[data-nbaview]').forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  $('nba-refresh').addEventListener('click', () => load(true));

  window.Panel.register('basketball', {
    show() { load(false); },
    render,
    tick() { if (Date.now() - nba.at > 60000) load(false); },
  });
  window.Panel.register('*', { onSettings() { if (window.Panel.getTab() === 'basketball') render(); } });
})();
