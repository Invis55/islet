// The tabbed panel: Now (battery + next meeting), Calendar, Alerts, Clipboard, Notes, Settings.
// User-controlled strings (notification text, event titles, clipboard) are only ever set via textContent.
window.Panel = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const DAY = 86400000;
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hm = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let tab = 'now';
  const ext = {}; // extra tabs: name -> [ { show, render, tick, onSettings } ]; several modules may hook one tab; '*' = every tab
  const callExt = (name, method, ...args) => { for (const h of ext[name] || []) if (h[method]) h[method](...args); };
  let cal = { events: [], error: '', configured: false, updated: 0 };
  let notifs = { items: [], error: '' };
  let clips = [];
  let unseen = 0;

  /* ---------- tabs ---------- */
  function showTab(t) {
    tab = t;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('[data-page]').forEach((p) => p.classList.toggle('on', p.dataset.page === t));
    if (t === 'alerts') { unseen = 0; updateBadge(); }
    startLens(false);
    renderAll();
    callExt(t, 'show');
  }
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  function renderAll() {
    renderMeeting();
    if (tab === 'calendar') renderCalendar();
    if (tab === 'alerts') renderAlerts();
    if (tab === 'clipboard') renderClips();
    callExt(tab, 'render');
  }


  /* ---------- the tab bar's glass lens ---------- */
  const lens = $('lens'), tabsEl = $('tabs');
  let lensL = 0, lensW = 0, lensRaf = 0, lensLast = 0, lensSnap = true;
  function lensTarget() {
    const b = tabsEl.querySelector('.tab.on');
    return b ? { l: b.offsetLeft, w: b.offsetWidth } : null;
  }
  function lensFrame(now) {
    const t = lensTarget();
    if (!t) { lens.style.opacity = '0'; } else {
      const dt = Math.min(0.05, (now - lensLast) / 1000 || 0.016);
      const k = lensSnap ? 1 : 1 - Math.exp(-dt * 20);      // critically damped chase, frame-rate independent
      lensL += (t.l - lensL) * k; lensW += (t.w - lensW) * k;
      lens.style.opacity = '1';
      lens.style.transform = `translateX(${lensL}px)`;
      lens.style.width = `${Math.max(0, lensW)}px`;
      lensSnap = false;
    }
    lensLast = now;
    if (window.UI.isPanelOpen()) lensRaf = requestAnimationFrame(lensFrame); else lensRaf = 0;
  }
  function startLens(snap) {
    if (snap) lensSnap = true;
    if (!lensRaf) { lensLast = performance.now(); lensRaf = requestAnimationFrame(lensFrame); }
  }

  /* ---------- battery ---------- */
  const chip = $('chip-battery');
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => {
        const pct = Math.round(b.level * 100);
        $('batt-text').textContent = `${pct}%`;
        $('batt-fill').setAttribute('width', String(Math.max(1.5, 20 * b.level)));
        chip.classList.toggle('charging', b.charging);
        chip.classList.toggle('low', pct <= 20 && !b.charging);
      };
      ['levelchange', 'chargingchange'].forEach((ev) => b.addEventListener(ev, upd));
      upd();
    }).catch(() => { chip.hidden = true; });
  } else { chip.hidden = true; }

  /* ---------- calendar + next meeting ---------- */
  function relative(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  function nextMeeting() {
    const now = Date.now();
    return cal.events.find((e) => !e.allDay && e.end > now && e.start < now + DAY) || null;
  }
  function renderMeeting() {
    const e = nextMeeting();
    const join = $('meet-join');
    if (!e) {
      $('meet-text').textContent = cal.configured ? 'No meetings in the next 24 h' : 'Add your calendar in Settings';
      join.hidden = true;
      return;
    }
    const now = Date.now();
    $('meet-text').textContent = e.start <= now ? `${e.title} · now` : `${e.title} · in ${relative(e.start - now)}`;
    join.hidden = !e.join;
    join.onclick = () => window.islet.openJoin(e.join);
  }

  function renderCalendar() {
    const list = $('cal-list');
    list.replaceChildren();
    if (!cal.configured) {
      list.append(el('div', 'empty', 'Add your calendar’s .ics link in Settings to see your next 7 days here.'));
    } else if (!cal.events.length && !cal.error) {
      list.append(el('div', 'empty', 'Nothing on your calendar for the next 7 days.'));
    } else {
      const now = Date.now(), today = startOfDay(now);
      let lastDay = null;
      for (const e of cal.events) {
        const day = Math.max(startOfDay(e.start), today);
        if (day !== lastDay) {
          lastDay = day;
          const diff = Math.round((day - today) / DAY);
          list.append(el('div', 'day', diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow'
            : new Date(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })));
        }
        const row = el('div', 'ev' + (e.end <= now ? ' past' : '') + (e.start <= now && e.end > now ? ' live' : ''));
        row.append(el('span', 'ev-time', e.allDay ? 'All day' : hm(e.start)));
        const t = el('span', 'ev-title', e.title);
        if (e.location && !e.join) t.title = e.location;
        row.append(t);
        if (e.join) {
          const b = el('button', 'join', 'Join');
          b.addEventListener('click', () => window.islet.openJoin(e.join));
          row.append(b);
        }
        list.append(row);
      }
    }
    const st = $('cal-status');
    st.classList.toggle('err', !!cal.error);
    st.textContent = cal.error ? `Couldn’t load calendar: ${cal.error}` : cal.updated && cal.configured ? `Updated ${hm(cal.updated)}` : '';
  }
  $('cal-refresh').addEventListener('click', () => window.islet.refreshCalendar());
  window.islet.onCalendar((c) => { cal = c; renderMeeting(); if (tab === 'calendar') renderCalendar(); });

  /* ---------- notifications (Windows Action Center) ---------- */
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h`;
    return `${Math.floor(m / 1440)}d`;
  }
  function updateBadge() {
    const b = $('alerts-badge');
    b.hidden = unseen <= 0;
    b.textContent = unseen > 9 ? '9+' : String(unseen);
  }
  function renderAlerts() {
    const list = $('al-list');
    list.replaceChildren();
    if (!notifs.items.length) {
      list.append(el('div', 'empty', notifs.error ? '' : 'No notifications right now. Messages from WhatsApp, mail and other apps appear here.'));
    }
    for (const n of notifs.items) {
      const row = el('div', 'note-row');
      row.append(el('div', 'n-icon', n.icon));
      const body = el('div', 'n-body');
      const head = el('div', 'n-head');
      head.append(el('span', 'n-app', n.app), el('span', 'n-time', ago(n.t)));
      body.append(head, el('div', 'n-title', n.title));
      if (n.body) body.append(el('div', 'n-text', n.body));
      row.append(body);
      list.append(row);
    }
    const st = $('al-status');
    st.classList.toggle('err', !!notifs.error);
    st.textContent = notifs.error ? `Couldn’t read notifications: ${notifs.error}` : 'Read-only view of the Windows notification database';
  }
  window.islet.onNotifs((n) => {
    notifs = n;
    const fresh = (n.fresh || []).length;
    if (fresh) {
      if (!(window.UI.isPanelOpen() && tab === 'alerts')) { unseen += fresh; updateBadge(); }
      if (window.UI.settings.popupFromNotifs) {
        for (const id of n.fresh.slice(0, 3)) {
          const item = n.items.find((x) => x.id === id);
          if (item) window.UI.pushAlert({ title: `${item.app} · ${item.title}`.slice(0, 80), body: item.body.slice(0, 160), icon: item.icon, duration: 5000 });
        }
      }
    }
    if (tab === 'alerts') renderAlerts();
  });

  /* ---------- clipboard ---------- */
  function renderClips() {
    const list = $('clip-list');
    list.replaceChildren();
    if (!clips.length) {
      list.append(el('div', 'empty wide', window.UI.settings.clipboard
        ? 'Copy some text, or press Win+Shift+S for a screenshot, and it shows up here.'
        : 'Clipboard history is off. Turn it on in Settings.'));
      return;
    }
    for (const c of clips) {
      const card = el('div', 'clip ' + c.type);
      card.draggable = true;
      if (c.type === 'image') {
        const img = el('img'); img.src = c.thumb; img.draggable = false; card.append(img);
      } else {
        card.append(el('div', 'clip-text', c.text.slice(0, 220)));
      }
      card.append(el('div', 'clip-meta', `${c.type === 'image' ? 'Image' : 'Text'} · ${ago(c.ts)}`));
      card.addEventListener('click', () => window.islet.copyClip(c.id));
      card.addEventListener('dragstart', (ev) => {
        window.UI.setDragging(true);
        if (c.type === 'image') { ev.preventDefault(); window.islet.dragClip(c.id); } // native file drag from the main process
        else { ev.dataTransfer.setData('text/plain', c.text); ev.dataTransfer.effectAllowed = 'copy'; }
      });
      card.addEventListener('dragend', () => window.UI.setDragging(false));
      list.append(card);
    }
  }
  window.islet.onClips((items) => { clips = items; if (tab === 'clipboard') renderClips(); });
  window.islet.onDragEnd(() => window.UI.setDragging(false));
  $('clip-clear').addEventListener('click', () => window.islet.clearClips());

  /* ---------- inputs that need the keyboard ---------- */
  // The island window is not focusable (so it never steals focus). Make it focusable only while you type.
  function wireInput(elm) {
    elm.addEventListener('pointerdown', () => { window.islet.setFocusable(true); setTimeout(() => elm.focus(), 60); });
    elm.addEventListener('focus', () => window.UI.setTyping(true));
    elm.addEventListener('blur', () => window.UI.setTyping(false));
  }

  /* ---------- notes ---------- */
  const note = $('note');
  let noteTimer = null;
  wireInput(note);
  window.islet.loadNote().then((t) => { note.value = t || ''; });
  const saveNote = async () => {
    clearTimeout(noteTimer);
    const ok = await window.islet.saveNote(note.value);
    $('note-status').textContent = ok ? 'Saved' : 'Couldn’t save';
  };
  note.addEventListener('input', () => {
    $('note-status').textContent = 'Saving…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 500);
  });
  note.addEventListener('blur', saveNote);

  /* ---------- settings ---------- */
  const ics = $('set-ics');
  wireInput(ics);
  const saveIcs = () => { window.islet.updateSettings({ icsUrl: ics.value }); ics.blur(); };
  $('set-ics-save').addEventListener('click', saveIcs);
  ics.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveIcs(); });
  for (const key of ['notch', 'musicPill', 'sound', 'popupFromNotifs', 'clipboard', 'autostart']) {
    $(`set-${key}`).addEventListener('change', (e) => window.islet.updateSettings({ [key]: e.target.checked }));
  }
  function onSettings(s) {
    for (const key of ['notch', 'musicPill', 'sound', 'popupFromNotifs', 'clipboard', 'autostart']) $(`set-${key}`).checked = !!s[key];
    if (document.activeElement !== ics) ics.value = s.icsUrl || '';
    if (tab === 'clipboard') renderClips();
    callExt('*', 'onSettings', s);
  }

  /* ---------- lifecycle (called from app.js) ---------- */
  function tick() {
    $('clock-time').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (tab === 'now') renderMeeting();
    callExt(tab, 'tick');
    callExt('*', 'tick');
  }
  function onOpen() { tick(); renderAll(); startLens(true); }

  tick();
  return { tick, onOpen, onSettings, showTab, register: (name, hooks) => { (ext[name] = ext[name] || []).push(hooks); }, wireInput, el, getTab: () => tab };
})();
