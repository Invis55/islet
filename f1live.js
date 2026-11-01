'use strict';
// Live / replay engine. A "source" (OpenF1, or the offline demo) supplies car positions, race control, positions and gaps;
// the feed keeps a small buffer, plays it back at a playhead (live: a few seconds behind real time; replay: at 1x/4x/16x),
// and emits normalised frames for the UI plus track-status changes for the ambient light.
const { TrackState } = require('./trackstate');
const { createOpenF1, createAuth, isLiveWindow } = require('./openf1');
const { createDemoSource } = require('./f1demo');

const MINUTE = 60000;
const FLAG_EVENTS = (e) => /^(flag|safetycar)$/i.test(e.category || '') && !/^(BLUE|BLACK AND WHITE|BLACK)$/i.test(e.flag || '');

class LiveFeed {
  constructor({ source, clock = Date.now, mode = 'replay', speed = 1, startAt = null, emit = () => {}, lag = 6000, fast = false, loop = false }) {
    Object.assign(this, { source, clock, mode, speed, startAt, emit, lag, fast, loop });
    this.state = new TrackState();
    this.slow = 1;                       // back-off multiplier after rate limiting
    this.series = { loc: this._series(), pos: this._series(), int: this._series() };
    this.messages = [];
    this.lap = null;
    this.frameNo = 0;
    this.trail = []; this.tf = null; this.outline = null; this.outlineTried = 0;
    this.rcAll = []; this.rcIdx = 0; this.rcTo = null; this.rcLast = 0;
    this.lastError = '';
  }
  _series() { return { to: null, busy: false, last: 0, data: new Map() }; }

  /* ---------- lifecycle ---------- */
  async start({ autoTick = true } = {}) {
    this.session = await this.source.session();
    this.drivers = await this.source.drivers();
    this.byNum = new Map(this.drivers.map((d) => [d.n, d]));
    const begin = this.startAt != null ? this.startAt : this.session.start;
    this.simBase = begin; this.wallBase = this.clock();
    this.emit({ type: 'session', session: { name: this.session.name, circuit: this.session.circuit, country: this.session.country, key: this.session.key, demo: !!this.source.demo },
      drivers: this.drivers, speed: this.speed, live: this.mode === 'live' });
    await this._loadRaceControl(this.mode === 'live' ? this.clock() : begin);
    await this._outline();
    if (autoTick) this.timer = setInterval(() => this.tick().catch(() => {}), 250);
  }
  stop() { clearInterval(this.timer); this.timer = null; this.stopped = true; }

  playhead() { return this.mode === 'live' ? this.clock() - this.lag : this.simBase + (this.clock() - this.wallBase) * this.speed; }
  setSpeed(x) { const ph = this.playhead(); this.simBase = ph; this.wallBase = this.clock(); this.speed = x; this.emit({ type: 'speed', speed: x }); }

  /* ---------- race control ---------- */
  async _loadRaceControl(upTo) {
    try {
      const from = this.mode === 'live' ? this.session.start - 30 * MINUTE : this.session.start - 30 * MINUTE;
      this.rcAll = (await this.source.raceControl(from, this.mode === 'live' ? undefined : this.session.end + 10 * MINUTE)).sort((a, b) => a.t - b.t);
    } catch (e) { this._error(e); this.rcAll = []; }
    this._replayState(upTo);
  }
  // rebuild the track status as it was at time t (silently), then announce it once
  _replayState(t) {
    this.state.reset(); this.messages = []; this.lap = null;
    this.rcIdx = 0;
    while (this.rcIdx < this.rcAll.length && this.rcAll[this.rcIdx].t <= t) this._applyEvent(this.rcAll[this.rcIdx++], true);
    this.rcTo = this.rcAll.length ? this.rcAll[this.rcAll.length - 1].t : t;
    this._announce(false);
  }
  _applyEvent(ev, silent) {
    const r = this.state.apply(ev);
    if (ev.lap != null) this.lap = ev.lap;
    if (ev.category && /flag|safetycar|sessionstatus|other/i.test(ev.category) && ev.message) { this.messages.push({ t: ev.t, text: ev.message }); if (this.messages.length > 10) this.messages.shift(); }
    if (!silent && r.changed) this._announce(r.pulseGreen, ev);
  }
  _announce(pulseGreen, ev) {
    this.emit({ type: 'flag', ...this.state.view(), pulseGreen: !!pulseGreen, lap: this.lap, messages: this.messages.slice(-4), event: ev ? { t: ev.t, flag: ev.flag, message: ev.message } : null });
  }
  async _pollRaceControl() {
    const now = this.clock();
    if (now - this.rcLast < (this.fast ? 5000 : 10000) * this.slow) return;
    this.rcLast = now;
    try {
      const rows = await this.source.raceControl(this.rcTo + 1, undefined);
      for (const ev of rows.filter((r) => r.t > this.rcTo)) { this.rcAll.push(ev); this._applyEvent(ev, false); this.rcTo = Math.max(this.rcTo, ev.t); }
      this._ok();
    } catch (e) { this._error(e); }
  }

  /* ---------- outline of the circuit ---------- */
  _setOutline(points, kind) {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 50, scale = 900 / Math.max(maxX - minX, maxY - minY, 1);
    this.tf = { minX, maxY, scale, pad, w: Math.round((maxX - minX) * scale + 2 * pad), h: Math.round((maxY - minY) * scale + 2 * pad) };
    this.outline = points;
    this.emit({ type: 'outline', kind, view: { w: this.tf.w, h: this.tf.h }, path: points.map((p) => this._norm(p.x, p.y)) });
  }
  _norm(x, y) { return [Math.round(((x - this.tf.minX) * this.tf.scale + this.tf.pad) * 10) / 10, Math.round(((this.tf.maxY - y) * this.tf.scale + this.tf.pad) * 10) / 10]; }
  async _outline() {
    if (this.outlineKind === 'lap' || !this.source.outline) return;
    this.outlineTried = this.clock();
    try {
      const pts = await this.source.outline(this.drivers.map((d) => d.n));
      if (pts && pts.length > 40) { this.outlineKind = 'lap'; this._setOutline(pts, 'lap'); }
    } catch (e) { this._error(e); }
  }
  // until a clean lap exists, draw the path the first car has driven so far
  _growTrail(ph) {
    if (this.outlineKind === 'lap' || !this.drivers.length) return;
    const a = this.series.loc.data.get(this.drivers[0].n);
    if (!a || !a.length) return;
    const last = this.trail[this.trail.length - 1];
    for (const s of a) if (s.t <= ph && (!last || s.t > last.t) && (!this.trail.length || Math.hypot(s.x - this.trail[this.trail.length - 1].x, s.y - this.trail[this.trail.length - 1].y) > 20)) this.trail.push(s);
    if (this.trail.length > 8 && this.clock() - (this.trailEmit || 0) > 4000) { this.trailEmit = this.clock(); this._setOutline(this.trail.slice(-500), 'trail'); }
  }

  /* ---------- buffered series ---------- */
  _cfg(kind) {
    const sp = Math.max(1, this.speed);
    // Replay fetches ahead in chunks that scale with speed, so the request rate stays flat however fast you play it.
    // Live polls on a fixed cadence. Both stay well inside OpenF1's 30/min (free) and 60/min (sponsor) caps.
    return {
      loc: { method: 'location', chunk: 10000 * sp, ahead: 10000 * sp, gap: this.fast ? 2500 : 5000, back: 3000, keep: 12000 },
      pos: { method: 'positions', chunk: 60000 * sp, ahead: 60000 * sp, gap: this.fast ? 15000 : 25000, back: 20000, keep: 90000 },
      int: { method: 'intervals', chunk: 60000 * sp, ahead: 60000 * sp, gap: this.fast ? 15000 : 25000, back: 20000, keep: 90000 },
    }[kind];
  }

  async _fill(kind, ph) {
    const s = this.series[kind], cfg = this._cfg(kind), now = this.clock();
    if (s.busy) return;
    if (this.mode === 'replay') { if (s.to != null && s.to > ph + cfg.ahead) return; } else if (now < s.last + cfg.gap * this.slow) return;
    s.busy = true;
    try {
      const rep = this.mode === 'replay';
      const from = s.to != null ? s.to : (rep ? ph - cfg.back : now - cfg.back - this.lag);
      const to = rep ? from + cfg.chunk : undefined;
      const rows = await this.source[cfg.method](from, to);
      for (const r of rows) {
        let a = s.data.get(r.n); if (!a) { a = []; s.data.set(r.n, a); }
        if (!a.length || r.t > a[a.length - 1].t) a.push(r); else if (r.t > a[0].t) { if (!a.some((x) => x.t === r.t)) { a.push(r); a.sort((x, y) => x.t - y.t); } }
      }
      s.to = rep ? to : rows.reduce((m, r) => Math.max(m, r.t + 1), from);
      s.last = now;
      for (const [n, a] of s.data) { while (a.length > 2 && a[1].t < ph - cfg.keep) a.shift(); if (!a.length) s.data.delete(n); }
      this._ok();
    } catch (e) { this._error(e); s.last = now + (e.retryAfter || 5) * 1000; } finally { s.busy = false; }
  }
  _ok() { this.slow = Math.max(1, this.slow * 0.9); if (this.lastError) { this.lastError = ''; this.emit({ type: 'status', error: '' }); } }
  _error(e) {
    if (e && e.kind === 'rate') this.slow = Math.min(8, this.slow * 2);
    if (e && e.kind === 'auth' && this.mode === 'live') {
      this.emit({ type: 'status', error: e.message, kind: 'auth' });
      this.stop();
      return;
    }
    const msg = (e && e.message) || String(e);
    if (msg !== this.lastError) { this.lastError = msg; this.emit({ type: 'status', error: msg, kind: e && e.kind }); }
  }

  _interp(n, ph) {
    const a = this.series.loc.data.get(n);
    if (!a || !a.length) return null;
    if (ph <= a[0].t) return a[0];
    for (let i = 0; i + 1 < a.length; i++) {
      if (ph >= a[i].t && ph < a[i + 1].t) { const f = (ph - a[i].t) / (a[i + 1].t - a[i].t); return { x: a[i].x + (a[i + 1].x - a[i].x) * f, y: a[i].y + (a[i + 1].y - a[i].y) * f }; }
    }
    return a[a.length - 1];
  }
  _latest(kind, n, ph) {
    const a = this.series[kind].data.get(n); if (!a) return null;
    let best = null; for (const r of a) if (r.t <= ph + (this.mode === 'live' ? this.lag : 0)) best = r; else break;
    return best;
  }

  /* ---------- one step ---------- */
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const ph = this.playhead();
      if (this.mode === 'replay' && ph > this.session.end) {
        if (this.loop) { this.restart(); return; }
        this.emit({ type: 'status', ended: true }); this.stop(); return;
      }
      await Promise.all([this._fill('loc', ph), this._fill('pos', ph), this._fill('int', ph)]);
      if (this.mode === 'replay') {
        while (this.rcIdx < this.rcAll.length && this.rcAll[this.rcIdx].t <= ph) this._applyEvent(this.rcAll[this.rcIdx++], false);
      } else await this._pollRaceControl();
      if (this.outlineKind !== 'lap' && this.source.outline && this.clock() - this.outlineTried > 30000 && this.mode === 'live') this._outline();
      this._growTrail(ph);
      if (!this.tf) return;
      const cars = [];
      for (const d of this.drivers) { const p = this._interp(d.n, ph); if (p) { const [x, y] = this._norm(p.x, p.y); cars.push({ n: d.n, x, y }); } }
      const frame = { type: 'frame', t: ph, cars, lap: this.lap, speed: this.speed };
      if (this.frameNo++ % 4 === 0) {
        frame.tower = this.drivers.map((d) => ({ n: d.n, pos: (this._latest('pos', d.n, ph) || {}).pos, gap: (this._latest('int', d.n, ph) || {}).gap }))
          .filter((r) => r.pos != null).sort((a, b) => a.pos - b.pos);
      }
      this.emit(frame);
    } finally { this.ticking = false; }
  }

  /* ---------- controls ---------- */
  restart() {
    this.simBase = this.session.start; this.wallBase = this.clock();
    for (const k of Object.keys(this.series)) this.series[k] = this._series();
    this._replayState(this.simBase);
  }
  jumpToNextFlag() {
    const ph = this.playhead();
    const ev = this.rcAll.find((e) => e.t > ph + 2000 && FLAG_EVENTS(e));
    if (!ev) return false;
    this.simBase = ev.t - 4000; this.wallBase = this.clock();
    for (const k of Object.keys(this.series)) this.series[k] = this._series();
    this._replayState(this.simBase);
    return true;
  }
  snapshot() {
    return { session: this.session && { name: this.session.name, circuit: this.session.circuit, country: this.session.country, demo: !!this.source.demo }, drivers: this.drivers, speed: this.speed, live: this.mode === 'live', flag: { ...this.state.view(), lap: this.lap, messages: this.messages.slice(-4) } };
  }
}

/* ---------- manager: picks live / replay / demo and watches for real sessions ---------- */
function createLiveManager({ fetchFn = globalThis.fetch, getCreds = () => null, emit = () => {}, onAlert = () => {}, clock = Date.now, limiter } = {}) {
  const auth = createAuth({ fetchFn, getCreds, clock });
  const api = createOpenF1({ fetchFn, auth, clock, ...(limiter ? { limiter } : {}) });
  let feed = null, mode = 'idle', watchTimer = null, lastSession = null;
  let waitingFor = null;        // a session we could not follow live; replay it once its data is free
  let sponsorNeeded = false;    // OpenF1 refused live data, so don't keep asking this session
  const wrap = (e) => emit({ ...e, feedMode: mode });
  const brief = (s) => s && ({ key: s.key, name: s.name, circuit: s.circuit, country: s.country, start: s.start, end: s.end });

  async function begin(source, opts) {
    stop();
    mode = opts.mode === 'live' ? 'live' : source.demo ? 'demo' : 'replay';
    feed = new LiveFeed({ source, clock, emit: wrap, fast: auth.signedIn(), ...opts });
    try { await feed.start(); } catch (e) { stop(); throw e; }
    return feed;
  }
  function stop() { if (feed) feed.stop(); feed = null; if (mode !== 'idle') { mode = 'idle'; emit({ type: 'stopped', feedMode: mode }); } }

  function sayGated(s) {
    emit({ type: 'gated', session: brief(s), signedIn: auth.signedIn(), feedMode: mode,
      error: 'Live timing needs an OpenF1 sponsor account (\u20ac9.90/month). Islet will replay this session automatically once it finishes.' });
  }

  async function watchOnce() {
    if (mode === 'replay' || mode === 'demo') return;   // the user is watching something else
    try {
      const s = await api.latestSession();
      if (!s) return;
      lastSession = s;
      const now = clock();
      if (isLiveWindow(s, now)) {
        if (mode === 'live') return;                     // already following it
        if (sponsorNeeded && !auth.signedIn()) { waitingFor = s; sayGated(s); return; }
        try {
          await begin(api.sourceFor(s), { mode: 'live' });
          waitingFor = null; sponsorNeeded = false;
          onAlert({ title: 'F1 session live', body: `${s.name} \u00b7 ${s.circuit}`, icon: '\ud83c\udfc1' });
        } catch (e) {
          if (!e || e.kind !== 'auth') throw e;
          sponsorNeeded = true; waitingFor = s; sayGated(s);
        }
        return;
      }
      if (mode === 'live') stop();                       // the session is over
      // Its data is free again now, so pick up the session we could not watch live.
      if (waitingFor && waitingFor.key === s.key) {
        const was = waitingFor; waitingFor = null; sponsorNeeded = false;
        onAlert({ title: 'Ready to replay', body: `${was.name} \u00b7 ${was.circuit}`, icon: '\ud83c\udfc1', duration: 8000 });
        emit({ type: 'ready', session: brief(was), feedMode: mode });
      }
      emit({ type: 'idle', last: brief(s), signedIn: auth.signedIn() });
    } catch (e) { emit({ type: 'status', error: e.message, kind: e.kind, feedMode: mode }); }
  }
  function startWatch(everyMs = 60000) { clearInterval(watchTimer); watchTimer = setInterval(watchOnce, everyMs); watchOnce(); }
  function stopWatch() { clearInterval(watchTimer); watchTimer = null; }

  async function replay(kind = 'latest') {
    const year = new Date(clock()).getUTCFullYear();
    const usable = (list) => list.filter((s) => s.end < clock() && !isLiveWindow(s, clock()));
    let sessions = usable(await api.recentSessions(year));
    if (!sessions.length) sessions = usable(await api.recentSessions(year - 1));
    const want = { race: /^race$/i, qualifying: /^qualifying$/i, sprint: /^sprint$/i };
    const pool = want[kind] ? sessions.filter((s) => want[kind].test(s.name)) : sessions;
    const s = pool[pool.length - 1];
    if (!s) throw new Error('No finished session found to replay');
    waitingFor = null;
    return begin(api.sourceFor(s), { mode: 'replay', speed: 1, startAt: s.start });
  }
  async function demo() { return begin(createDemoSource(), { mode: 'replay', speed: 1, loop: true }); }

  return {
    api, auth, watchOnce, startWatch, stopWatch, replay, demo, stop,
    setSpeed: (x) => feed && feed.setSpeed(x), jumpNextFlag: () => !!(feed && feed.jumpToNextFlag()),
    signedIn: () => auth.signedIn(),
    forgetGate() { sponsorNeeded = false; waitingFor = null; },
    snapshot: () => ({ mode, last: brief(lastSession), signedIn: auth.signedIn(), feed: feed ? feed.snapshot() : null }),
    get mode() { return mode; },
  };
}

module.exports = { LiveFeed, createLiveManager };
