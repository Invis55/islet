const assert = require('assert');
const { parseToast, friendlyApp, toItems } = require('../notifications');

const whatsapp = `<toast launch="x"><visual><binding template="ToastGeneric"><text id="1">Ayesha</text><text id="2">Are you coming to dinner? &amp; bring the &lt;docs&gt;</text><text placement="attribution">via WhatsApp</text></binding></visual></toast>`;
assert.deepStrictEqual(parseToast(whatsapp), { title: 'Ayesha', body: 'Are you coming to dinner? & bring the <docs>' });
assert.deepStrictEqual(parseToast('<toast><visual><binding><text>Only title</text></binding></visual></toast>'), { title: 'Only title', body: '' });
assert.deepStrictEqual(parseToast(''), { title: '', body: '' });
assert.strictEqual(parseToast('<toast><text>Caf&#233; &#x1F600;</text></toast>').title, 'Café 😀');

assert.deepStrictEqual(friendlyApp('5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'), { name: 'WhatsApp', icon: '💬' });
assert.strictEqual(friendlyApp('Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookForWindows').name, 'Mail');
assert.strictEqual(friendlyApp('MSTeams_8wekyb3d8bbwe!MSTeams').name, 'Teams');
assert.strictEqual(friendlyApp('Windows.SystemToast.SecurityAndMaintenance').name, 'Windows');
assert.strictEqual(friendlyApp('Acme.CoolNotes_abc123!App').name, 'Cool Notes');
assert.strictEqual(friendlyApp('').name, 'App');

const items = toItems([
  { id: 1, t: 1000, app: 'Chrome', payload: '<toast><text>Old</text></toast>' },
  { id: 2, t: 2000, app: '5319275A.WhatsAppDesktop_x!App', payload: whatsapp },
  { id: 3, t: 3000, app: 'x', payload: '<toast></toast>' }, // empty -> dropped
]);
assert.deepStrictEqual(items.map((i) => i.id), [2, 1]);
console.log('notification parser tests passed');
