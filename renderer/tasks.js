// Tasks: a plain checklist kept on this PC. Saved on every change (validated again in the main process).
// Task text is user-typed: only ever set with textContent.
(() => {
  const $ = (id) => document.getElementById(id);
  const { el } = window.Panel;
  let items = [];
  let loaded = false;
  let saveTimer = 0;

  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.islet.tasksSave(items), 250);
  }

  function render() {
    const list = $('tk-list');
    list.replaceChildren();
    if (!items.length) { list.append(el('div', 'empty', 'Nothing here yet. Add what you need to do today.')); }
    for (const t of items) {
      const row = el('div', 'tk-row' + (t.done ? ' done' : ''));
      const box = el('button', 'tk-box', t.done ? '✓' : '');
      box.setAttribute('aria-label', t.done ? 'Mark as not done' : 'Mark as done');
      box.addEventListener('click', () => { t.done = !t.done; render(); save(); });
      const text = el('span', 'tk-text', t.text);
      text.addEventListener('dblclick', () => { // rename in place
        const input = el('input'); input.type = 'text'; input.value = t.text; input.maxLength = 200; input.className = 'tk-edit';
        const commit = () => { const v = input.value.trim(); if (v) t.text = v; render(); save(); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') render(); });
        input.addEventListener('blur', commit);
        text.replaceWith(input); input.focus(); input.select();
      });
      const del = el('button', 'tk-del', '×');
      del.setAttribute('aria-label', 'Delete task');
      del.addEventListener('click', () => { items = items.filter((x) => x.id !== t.id); render(); save(); });
      row.append(box, text, del);
      list.append(row);
    }
    const done = items.filter((t) => t.done).length;
    $('tk-count').textContent = items.length ? `${done} of ${items.length} done` : '';
    $('tk-clear').hidden = !done;
  }

  function add() {
    const input = $('tk-input');
    const text = input.value.trim();
    if (!text) return;
    if (items.length >= 200) { window.UI.pushAlert({ title: 'Task list is full', body: 'Remove some tasks to add more.', icon: '✅', duration: 3500 }); return; }
    items = [{ id: newId(), text: text.slice(0, 200), done: false }, ...items];
    input.value = '';
    render(); save();
  }
  $('tk-add').addEventListener('click', add);
  $('tk-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $('tk-clear').addEventListener('click', () => { items = items.filter((t) => !t.done); render(); save(); });

  async function load() {
    if (loaded) return;
    loaded = true;
    try { items = (await window.islet.tasksLoad()) || []; } catch { items = []; }
    render();
  }

  window.Panel.register('tasks', { show() { load(); }, render });
  load();
})();
