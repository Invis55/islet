const assert = require('assert');
const { ClipHistory } = require('../cliphistory');

const h = new ClipHistory(3);
assert.ok(h.add({ key: 't:a', type: 'text', text: 'a' }).added);
h.add({ key: 't:b', type: 'text', text: 'b' });
h.add({ key: 'i:1', type: 'image', file: '/tmp/1.png' });
assert.deepStrictEqual(h.items.map((i) => i.key), ['i:1', 't:b', 't:a']);

// 4th item pushes the oldest out and reports it so its file can be deleted
let r = h.add({ key: 'i:2', type: 'image', file: '/tmp/2.png' });
assert.deepStrictEqual(r.removed.map((i) => i.key), ['t:a']);
assert.strictEqual(h.items.length, 3);

// copying an existing item again moves it to the front instead of duplicating it
r = h.add({ key: 't:b' });
assert.strictEqual(r.added, false);
assert.deepStrictEqual(h.items.map((i) => i.key), ['t:b', 'i:2', 'i:1']);

// an evicted image has its file reported exactly once
r = h.add({ key: 't:c', type: 'text', text: 'c' });
assert.deepStrictEqual(r.removed.map((i) => i.file), ['/tmp/1.png']);
assert.strictEqual(h.get(h.items[0].id).key, 't:c');
assert.strictEqual(h.clear().length, 3);
assert.strictEqual(h.items.length, 0);
console.log('clip history tests passed');
