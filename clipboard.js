'use strict';
// Polls the system clipboard (Electron has no change event) and keeps the last 3 text/image items.
// Win+Shift+S screenshots land on the clipboard as images, so they are picked up here too.
const { clipboard, nativeImage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ClipHistory } = require('./cliphistory');

const MAX_TEXT = 20000;

function imageKey(img) {
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();
  const step = Math.max(1, Math.floor(bmp.length / 65536));
  const sample = Buffer.alloc(Math.min(65536, bmp.length));
  for (let i = 0, j = 0; j < sample.length; i += step, j++) sample[j] = bmp[i];
  return 'i:' + crypto.createHash('sha1').update(`${width}x${height}`).update(sample).digest('hex');
}

function startClipboard({ dir, isEnabled, onChange }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* stale */ } } // clean old session

  const history = new ClipHistory(3);
  let lastKey = '';
  let tick = 0;

  const publish = () => onChange(history.items.map((c) => ({
    id: c.id, type: c.type, ts: c.ts, text: c.text, thumb: c.thumb,
  })));
  const dropFiles = (items) => items.forEach((c) => { if (c.file) fs.unlink(c.file, () => {}); });

  function poll() {
    tick++;
    if (!isEnabled()) return;
    let formats;
    try { formats = clipboard.availableFormats(); } catch { return; }
    if (!formats.length) return;

    // Password managers mark their clipboard writes with this format: never record those.
    try { if (clipboard.readBuffer('ExcludeClipboardContentFromMonitorProcessing').length) return; } catch { /* format not registered */ }

    const text = clipboard.readText();
    if (text && text.trim()) {
      const t = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
      const key = 't:' + t;
      if (key === lastKey) return;
      lastKey = key;
      const r = history.add({ key, type: 'text', text: t });
      dropFiles(r.removed); publish();
      return;
    }

    if (!formats.some((f) => f.startsWith('image/'))) return;
    // An unchanged image stays on the clipboard; re-reading a 4K screenshot is costly, so recheck it less often.
    if (lastKey.startsWith('i:') && tick % 3 !== 0) return;

    const img = clipboard.readImage();
    if (img.isEmpty()) return;
    const key = imageKey(img);
    if (key === lastKey) return;
    lastKey = key;
    const existing = history.items.find((c) => c.key === key);
    if (existing) { history.add({ key }); publish(); return; }

    const file = path.join(dir, `clip-${Date.now()}.png`);
    try { fs.writeFileSync(file, img.toPNG()); } catch { return; }
    const thumb = img.resize({ width: 240, quality: 'good' });
    const icon = img.resize({ width: 64 });
    const r = history.add({ key, type: 'image', file, thumb: thumb.toDataURL(), icon });
    dropFiles(r.removed); publish();
  }

  const timer = setInterval(poll, 800);
  return {
    items: () => history.items.map((c) => ({ id: c.id, type: c.type, ts: c.ts, text: c.text, thumb: c.thumb })),
    copyBack(id) {
      const c = history.get(id);
      if (!c) return;
      if (c.type === 'text') clipboard.writeText(c.text);
      else if (c.file) clipboard.writeImage(nativeImage.createFromPath(c.file));
    },
    dragInfo(id) {
      const c = history.get(id);
      return c && c.type === 'image' ? { file: c.file, icon: c.icon } : null;
    },
    clear() { dropFiles(history.clear()); lastKey = ''; publish(); },
    stop() { clearInterval(timer); },
  };
}

module.exports = { startClipboard };
