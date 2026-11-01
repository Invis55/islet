'use strict';
// Last-N clipboard items, de-duplicated by key. Pure logic, no Electron.
class ClipHistory {
  constructor(max = 3) { this.max = max; this.items = []; this.seq = 0; }

  // item: { key, type: 'text'|'image', text?, file?, thumb?, icon? }
  // returns { added: bool, removed: [items that fell off the end] }
  add(item) {
    const i = this.items.findIndex((x) => x.key === item.key);
    if (i >= 0) { // copied again: move to the front, keep the existing entry (and its file)
      const [ex] = this.items.splice(i, 1);
      ex.ts = Date.now();
      this.items.unshift(ex);
      return { added: false, removed: [], duplicate: item };
    }
    this.items.unshift({ ...item, id: ++this.seq, ts: Date.now() });
    const removed = [];
    while (this.items.length > this.max) removed.push(this.items.pop());
    return { added: true, removed };
  }

  get(id) { return this.items.find((x) => x.id === id); }
  clear() { const old = this.items; this.items = []; return old; }
}

module.exports = { ClipHistory };
