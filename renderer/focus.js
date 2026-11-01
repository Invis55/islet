// Focus timer (Pomodoro): work and break phases that run on their own, an alert at each change,
// and a compact pill on the island while a session is running.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  const f = { work: 25, brk: 5, phase: 'work', left: 25 * 60000, endAt: 0, running: false, done: 0 };
  const total = () => (f.phase === 'work' ? f.work : f.brk) * 60000;
  const remaining = () => (f.running ? Math.max(0, f.endAt - Date.now()) : f.left);

  function setPhase(p) {
    f.phase = p;
    f.left = total();
    if (f.running) f.endAt = Date.now() + f.left;
  }
  function start() { f.running = true; f.endAt = Date.now() + f.left; }
  function pause() { f.left = remaining(); f.running = false; }
  function reset() { f.running = false; setPhase('work'); }
  function skip() { setPhase(f.phase === 'work' ? 'break' : 'work'); }   // a skipped block doesn't count

  // Alerts that arrive during a work block are held (if the setting is on) and summarised at the break.
  const held = [];
  function hold(a) {
    const s = window.UI.settings;
    if (!f.running || f.phase !== 'work' || !s || s.quietFocus === false || (s.modules && s.modules.focus === false)) return false;
    held.push(`${a.title || 'Alert'}${a.body ? `: ${a.body}` : ''}`);
    if (held.length > 50) held.shift();
    return true;
  }
  // The break alert carries the summary, so there is one alert to read rather than a queue.
  function heldSummary() {
    if (!held.length) return '';
    const n = held.length;
    const text = `${n} alert${n === 1 ? '' : 's'} held: ${held.slice(-3).join(' · ')}`;
    held.length = 0;
    return ` ${text}`.slice(0, 220);
  }

  function paint() {
    const label = f.phase === 'work' ? 'Focus' : 'Break';
    $('fo-big').textContent = fmt(remaining());
    $('fo-phase').textContent = label;
    $('fo-phase').dataset.phase = f.phase;
    $('fo-go').textContent = f.running ? 'Pause' : f.left < total() ? 'Resume' : 'Start';
    $('fo-count').textContent = f.done ? `${f.done} focus block${f.done === 1 ? '' : 's'} done this session` : 'Each finished focus block is counted here';
    document.querySelectorAll('#fo-presets button').forEach((b) => b.classList.toggle('on', Number(b.dataset.w) === f.work));
    const t = $('fo-time'); if (t) t.textContent = fmt(remaining());
    const lab = $('fo-label'); if (lab) lab.textContent = label;
    const dot = $('fo-dot'); if (dot) dot.dataset.phase = f.phase;
  }

  // One clock for the panel and the island. It keeps running while the panel is closed.
  setInterval(() => {
    if (f.running && Date.now() >= f.endAt) {
      if (f.phase === 'work') {
        f.done += 1;
        setPhase('break');
        const summary = heldSummary();
        window.UI.pushAlert({ title: 'Break time', body: `${f.brk} minutes. You finished a focus block.${summary}`, icon: summary ? '🔕' : '☕', duration: summary ? 9000 : 6000 });
      } else {
        setPhase('work');
        window.UI.pushAlert({ title: 'Back to focus', body: `${f.work} minutes starts now.`, icon: '🎯', duration: 6000 });
      }
      window.UI.render();
    }
    paint();
  }, 500);

  $('fo-go').addEventListener('click', () => { if (f.running) pause(); else start(); paint(); window.UI.render(); });
  $('fo-reset').addEventListener('click', () => { reset(); paint(); window.UI.render(); });
  $('fo-skip').addEventListener('click', () => { skip(); paint(); window.UI.render(); });
  document.querySelectorAll('#fo-presets button').forEach((b) => b.addEventListener('click', () => {
    f.work = Number(b.dataset.w); f.brk = Number(b.dataset.b); f.running = false; setPhase('work'); paint(); window.UI.render();
  }));

  window.Panel.register('focus', { show: paint, render: paint });
  window.Focus = { active: () => f.running, remaining, phase: () => f.phase, hold, stop() { f.running = false; f.left = total(); held.length = 0; paint(); } };
  paint();
})();
