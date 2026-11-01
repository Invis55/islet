// Features switched on or off in Settings (and chosen during setup): hides their tabs, pages and chips.
(() => {
  const $ = (id) => document.getElementById(id);
  const MODULES = {
    sports: { tabs: ['football', 'f1', 'live', 'basketball'], chips: 'now-sports' },
    focus: { tabs: ['focus'] },
    tasks: { tabs: ['tasks'] },
  };
  const ON = (m) => ({ sports: m.sports !== false, focus: m.focus !== false, tasks: m.tasks !== false });

  function apply(m) {
    const on = ON(m || {});
    for (const [name, cfg] of Object.entries(MODULES)) {
      const show = on[name];
      document.querySelectorAll(cfg.tabs.map((t) => `[data-tab="${t}"]`).join(',')).forEach((b) => { b.hidden = !show; });
      document.querySelectorAll(cfg.tabs.map((t) => `[data-page="${t}"]`).join(',')).forEach((p) => { p.hidden = !show; });
      if (cfg.chips) { const c = $(cfg.chips); if (c) c.hidden = !show; }
      const box = $(`set-mod-${name}`); if (box) box.checked = show;
    }
    // Never leave the user on a page that was just switched off.
    const current = window.Panel.getTab();
    const gone = Object.entries(MODULES).some(([name, cfg]) => !on[name] && cfg.tabs.includes(current));
    if (gone) window.Panel.showTab('now');
    if (!on.focus && window.Focus) window.Focus.stop();
  }

  for (const name of Object.keys(MODULES)) {
    const box = $(`set-mod-${name}`);
    if (box) box.addEventListener('change', (e) => window.islet.updateSettings({ modules: { [name]: e.target.checked } }));
  }

  const readN = $('set-readNotifications');
  if (readN) readN.addEventListener('change', (e) => window.islet.updateSettings({ readNotifications: e.target.checked }));
  const quiet = $('set-quietFocus');
  if (quiet) quiet.addEventListener('change', (e) => window.islet.updateSettings({ quietFocus: e.target.checked }));

  window.Modules = { apply };
  window.Panel.register('*', { onSettings(s) { apply(s.modules); if (quiet) quiet.checked = s.quietFocus !== false; if (readN) readN.checked = s.readNotifications !== false; } });
})();
