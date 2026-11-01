// Live F1 tab: track map with moving cars, position tower, flag chip, replay / demo controls, OpenF1 sign-in.
// All text from the network is set with textContent only.
(() => {
  const $ = (id) => document.getElementById(id);
  const { el } = window.Panel;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const COLOR = /^#[0-9a-fA-F]{6}$/;

  let settings = window.UI.settings;
  const st = { mode: 'idle', session: null, drivers: new Map(), cars: new Map(), speed: 1, flag: null, last: null, error: '', errorKind: '', ended: false, running: false, gated: null, ready: null, signedIn: false };

  /* ---------- controls ---------- */
  function button(label, cls, fn) { const b = el('button', `pill glass ${cls || ''}`.trim(), label); b.addEventListener('click', fn); return b; }
  async function run(cmd) {
    const r = await window.islet.f1Live(cmd);
    if (r && r.ok === false && r.error) { st.error = r.error; st.errorKind = ''; renderStatus(); }
    return r;
  }
  function renderControls() {
    const box = $('lv-ctl'); box.replaceChildren();
    if (!st.running) {
      const label = st.ready ? `Replay ${st.ready.name}` : 'Replay last race';
      box.append(button(label, 'prom', () => { st.error = ''; st.ended = false; st.ready = null; run({ a: 'replay', kind: 'race' }); }),
        button('Demo', '', () => { st.error = ''; st.ended = false; run({ a: 'demo' }); }));
      if (st.gated && !st.signedIn) box.append(button('Get live timing', '', () => window.islet.openLink('https://openf1.org/')));
      return;
    }
    if (st.mode !== 'live') {
      const seg = el('div', 'seg glass');
      for (const x of [1, 4, 16]) { const b = el('button', st.speed === x ? 'on' : '', `${x}×`); b.addEventListener('click', () => { st.speed = x; renderControls(); run({ a: 'speed', x }); }); seg.append(b); }
      box.append(seg, button('Next flag', '', () => run({ a: 'jump' })));
    }
    box.append(button(st.mode === 'live' ? 'Leave' : 'Stop', '', () => run({ a: 'stop' })));
  }

  /* ---------- status line ---------- */
  function renderStatus() {
    const name = $('lv-name'), empty = $('lv-empty'), status = $('lv-status');
    name.textContent = st.session ? st.session.name + (st.session.circuit ? ` · ${st.session.circuit}` : '') : 'Live F1';
    let msg = '';
    if (st.gated) msg = 'Waiting for the session to finish';     // the panel already explains why
    else if (st.error) msg = st.error;
    else if (st.ended) msg = 'Replay finished';
    else if (st.running) msg = st.mode === 'live' ? 'LIVE' : st.mode === 'demo' ? 'Demo' : 'Replay';
    status.textContent = msg; status.classList.toggle('err', !!st.error && !st.gated);
    $('live-dot').hidden = !(st.running && st.mode === 'live');
    if (st.running && st.cars.size) { empty.hidden = true; return; }
    empty.hidden = false;
    if (st.running) empty.textContent = 'Waiting for the track map…';
    else if (st.ready) empty.textContent = `${st.ready.name} · ${st.ready.circuit} has finished and is ready to replay.`;
    else if (st.gated) empty.textContent = `${st.gated.session.name} · ${st.gated.session.circuit} is running now, but OpenF1 only serves live timing to sponsors (€9.90/month). Islet will replay it automatically once it finishes — or watch the demo meanwhile.`;
    else if (st.last) empty.textContent = `No session running. Last: ${st.last.name} · ${st.last.circuit}. Replay it, or try the demo.`;
    else empty.textContent = 'No session running. Replay the last race, or try the demo to see the flags and ambient light.';
  }
  function renderFlagChip() {
    const chip = $('lv-chip'), f = st.flag;
    const show = st.running && f && f.mode !== 'green';
    chip.hidden = !show;
    if (show) { chip.dataset.mode = f.mode; chip.textContent = f.label; }
    $('lv-svg').dataset.mode = f && st.running ? f.mode : 'green';
    $('lv-lap').textContent = st.running && f && f.lap != null ? `Lap ${f.lap}` : '';
    const msgs = f && f.messages && f.messages.length ? f.messages[f.messages.length - 1].text : '';
    $('lv-ticker').textContent = st.running ? msgs : '';
  }

  /* ---------- map ---------- */
  function setOutline(e) {
    const svg = $('lv-svg');
    svg.setAttribute('viewBox', `0 0 ${e.view.w} ${e.view.h}`);
    $('lv-path').setAttribute('d', e.path.length ? `M${e.path.map((p) => p.join(' ')).join('L')}${e.kind === 'lap' ? 'Z' : ''}` : '');
  }
  function carNode(n) {
    let c = st.cars.get(n);
    if (c) return c;
    const d = st.drivers.get(n) || { code: String(n), color: '#ffffff' };
    const g = svgEl('g', { class: 'lv-car' });
    const dot = svgEl('circle', { r: 13, fill: COLOR.test(d.color) ? d.color : '#ffffff' });
    const t = svgEl('text', { x: 18, y: 7 }); t.textContent = d.code;
    g.append(dot, t);
    $('lv-cars').append(g);
    c = { g, placed: false };
    st.cars.set(n, c);
    return c;
  }
  function setFrame(e) {
    const favs = new Set(settings.favDrivers || []);
    for (const car of e.cars) {
      const c = carNode(car.n);
      if (!c.placed) { c.g.style.transition = 'none'; c.placed = true; requestAnimationFrame(() => { c.g.style.transition = ''; }); }
      c.g.style.transform = `translate(${car.x}px, ${car.y}px)`;
      const d = st.drivers.get(car.n);
      c.g.classList.toggle('fav', !!(d && favs.has(d.code)));
    }
    if (e.cars.length && $('lv-empty').hidden === false) renderStatus();
    if (e.speed && e.speed !== st.speed) { st.speed = e.speed; renderControls(); }
  }
  function setTower(rows) {
    const favs = new Set(settings.favDrivers || []);
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const d = st.drivers.get(r.n); if (!d) continue;
      const row = el('div', `lv-row${favs.has(d.code) ? ' fav' : ''}`);
      const bar = el('i'); bar.style.background = COLOR.test(d.color) ? d.color : '#fff';
      row.append(el('span', 'p', String(r.pos)), bar, el('span', 'c', d.code), el('span', 'g', r.pos === 1 ? 'Leader' : r.gap != null ? (typeof r.gap === 'number' ? `+${r.gap.toFixed(1)}` : String(r.gap)) : ''));
      frag.append(row);
    }
    $('lv-tower').replaceChildren(frag);
    for (const [n, c] of st.cars) c.g.classList.toggle('lead', rows.length > 0 && rows[0].n === n);
  }

  /* ---------- events from the main process ---------- */
  function reset() {
    $('lv-cars').replaceChildren(); st.cars.clear(); $('lv-tower').replaceChildren(); $('lv-path').setAttribute('d', '');
    st.flag = null; st.speed = 1; st.ended = false; st.error = '';
  }
  window.islet.onF1Live((e) => {
    if (!e) return;
    if (e.feedMode) st.mode = e.feedMode;
    switch (e.type) {
      case 'session':
        reset(); st.running = true; st.session = e.session; st.mode = e.feedMode || st.mode; st.speed = e.speed || 1;
        st.drivers = new Map((e.drivers || []).map((d) => [d.n, d]));
        break;
      case 'outline': setOutline(e); break;
      case 'frame': setFrame(e); if (e.tower) setTower(e.tower); return;
      case 'flag': st.flag = e; break;
      case 'speed': st.speed = e.speed; break;
      case 'status':
        if (e.ended) { st.ended = true; st.running = false; }
        if (e.error !== undefined) { st.error = e.error; st.errorKind = e.kind || ''; }
        break;
      case 'idle': st.last = e.last; st.signedIn = !!e.signedIn; st.gated = null; break;
      case 'gated': st.gated = e; st.signedIn = !!e.signedIn; st.running = false; st.error = e.error; st.errorKind = 'auth'; break;
      case 'ready': st.ready = e.session; st.gated = null; st.error = ''; break;
      case 'stopped': st.running = false; st.session = null; st.mode = 'idle'; st.flag = null; reset(); break;
    }
    renderControls(); renderStatus(); renderFlagChip();
  });

  /* ---------- OpenF1 account + switches ---------- */
  const user = $('set-ofUser'), pass = $('set-ofPass');
  function renderAccount() {
    const signed = !!settings.openf1User;
    $('of-logout').hidden = !signed; $('of-login').hidden = signed;
    $('of-status').textContent = signed ? `Signed in as ${settings.openf1User}` : 'Not signed in — replays and demo still work';
    if (document.activeElement !== user) user.value = settings.openf1User || '';
    pass.hidden = signed; user.disabled = signed;
  }
  $('of-login').addEventListener('click', async () => {
    const btn = $('of-login'); btn.disabled = true; $('of-status').textContent = 'Signing in…';
    const r = await window.islet.f1Login(user.value, pass.value);
    btn.disabled = false; pass.value = '';
    if (!r.ok) $('of-status').textContent = r.error || 'Could not sign in';
  });
  $('of-logout').addEventListener('click', () => window.islet.f1Logout());
  $('of-link').addEventListener('click', () => window.islet.openLink('https://openf1.org/'));
  for (const key of ['f1Ambient', 'f1CalmLights', 'f1LiveWatch']) $(`set-${key}`).addEventListener('change', (ev) => window.islet.updateSettings({ [key]: ev.target.checked }));

  window.Panel.register('live', { show() { renderControls(); renderStatus(); renderFlagChip(); } });
  window.Panel.register('*', {
    onSettings(s) {
      settings = s;
      for (const key of ['f1Ambient', 'f1CalmLights', 'f1LiveWatch']) $(`set-${key}`).checked = key === 'f1CalmLights' ? !!s[key] : s[key] !== false;
      renderAccount();
    },
  });
  renderControls(); renderStatus();
})();
