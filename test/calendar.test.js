process.env.TZ = 'Asia/Karachi'; // must be set before anything touches Date
const assert = require('assert');
const http = require('http');
const { collect, loadEvents, findJoinLink, isAllowedJoinUrl } = require('../calendar');

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  // 1. single Google Meet event, Karachi time, link only in X-GOOGLE-CONFERENCE
  'BEGIN:VEVENT', 'UID:single@x', 'SUMMARY:Design review', 'DTSTART;TZID=Asia/Karachi:20261102T100000', 'DTEND;TZID=Asia/Karachi:20261102T103000',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij', 'END:VEVENT',
  // 2. weekly Mon/Wed standup, one occurrence excluded, one moved
  'BEGIN:VEVENT', 'UID:standup@x', 'SUMMARY:Standup', 'DTSTART;TZID=Asia/Karachi:20261005T110000', 'DTEND;TZID=Asia/Karachi:20261005T111500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=Asia/Karachi:20261104T110000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:standup@x', 'RECURRENCE-ID;TZID=Asia/Karachi:20261102T110000', 'SUMMARY:Standup (moved)',
  'DTSTART;TZID=Asia/Karachi:20261102T140000', 'DTEND;TZID=Asia/Karachi:20261102T141500', 'END:VEVENT',
  // 3. all-day
  'BEGIN:VEVENT', 'UID:allday@x', 'SUMMARY:Public holiday', 'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'END:VEVENT',
  // 4. Zoom in UTC, link in folded + escaped description
  'BEGIN:VEVENT', 'UID:zoom@x', 'SUMMARY:Client call', 'DTSTART:20261105T090000Z', 'DTEND:20261105T100000Z',
  'DESCRIPTION:Join Zoom Meeting\\nhttps://us02web.zoom.us/j/123456789?pwd=ab', ' cdEF\\nMeeting ID: 123', 'END:VEVENT',
  // 5. Teams link wrapped by Outlook SafeLinks
  'BEGIN:VEVENT', 'UID:teams@x', 'SUMMARY:Board sync', 'DTSTART;TZID=Pakistan Standard Time:20261106T150000', 'DTEND;TZID=Pakistan Standard Time:20261106T160000',
  'DESCRIPTION:<https://nam.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19%253ameeting_abc%2540thread.v2%2F0&data=zzz>',
  'END:VEVENT',
  // 6. daily x3 starting Nov 1 (COUNT)
  'BEGIN:VEVENT', 'UID:daily@x', 'SUMMARY:Daily x3', 'DTSTART;TZID=Asia/Karachi:20261101T080000', 'DTEND;TZID=Asia/Karachi:20261101T081000', 'RRULE:FREQ=DAILY;COUNT=3',
  'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'END:VALARM', 'END:VEVENT',
  // 7. first Friday of every month
  'BEGIN:VEVENT', 'UID:firstfri@x', 'SUMMARY:Monthly all-hands', 'DTSTART;TZID=Asia/Karachi:20261002T090000', 'DTEND;TZID=Asia/Karachi:20261002T100000',
  'RRULE:FREQ=MONTHLY;BYDAY=1FR', 'END:VEVENT',
  // 8. cancelled, and one outside the window
  'BEGIN:VEVENT', 'UID:cx@x', 'SUMMARY:Cancelled thing', 'DTSTART:20261102T120000Z', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:far@x', 'SUMMARY:Far future', 'DTSTART:20261201T120000Z', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

const NOW = new Date('2026-11-01T07:00:00Z'); // 12:00 in Karachi, a Sunday
const fmt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', hour12: false }).replace(',', '');

const ev = collect(ICS, NOW);
const line = (e) => `${fmt(e.start)} | ${e.title}${e.allDay ? ' [all-day]' : ''}${e.join ? ' [join]' : ''}`;
const got = ev.map(line);
console.log(got.join('\n'));

const expected = [
  '01/11/2026 08:00:00 | Daily x3',
  '02/11/2026 08:00:00 | Daily x3',
  '02/11/2026 10:00:00 | Design review [join]',
  '02/11/2026 14:00:00 | Standup (moved)',
  '03/11/2026 00:00:00 | Public holiday [all-day]',
  '03/11/2026 08:00:00 | Daily x3',
  '05/11/2026 14:00:00 | Client call [join]',
  '06/11/2026 09:00:00 | Monthly all-hands',
  '06/11/2026 15:00:00 | Board sync [join]',
];
assert.deepStrictEqual(got, expected);
assert.strictEqual(ev.find((e) => e.title === 'Client call').join, 'https://us02web.zoom.us/j/123456789?pwd=abcdEF');
assert.strictEqual(ev.find((e) => e.title === 'Board sync').join, 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0');
assert.ok(!ev.some((e) => e.title === 'Standup' ), 'excluded/moved occurrences must not appear as Standup');

// link helpers
assert.strictEqual(findJoinLink('see https://meet.google.com/xyz-abcd-efg.'), 'https://meet.google.com/xyz-abcd-efg');
assert.ok(isAllowedJoinUrl('https://us02web.zoom.us/j/1'));
assert.ok(!isAllowedJoinUrl('https://evil.com/?https://zoom.us/j/1'));
assert.ok(!isAllowedJoinUrl('http://meet.google.com/x'));
assert.ok(!isAllowedJoinUrl('file:///C:/Windows/System32/calc.exe'));

// end-to-end through a real HTTP server + webcal:// rewrite
(async () => {
  const srv = http.createServer((_q, r) => { r.end(ICS); }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/cal.ics`;
  const viaHttp = await loadEvents(url, { now: NOW });
  assert.strictEqual(viaHttp.length, expected.length);
  await assert.rejects(() => loadEvents('ftp://x/y.ics'), /https/);
  const bad = http.createServer((_q, r) => r.end('<html>login</html>')).listen(0, '127.0.0.1');
  await new Promise((r) => bad.once('listening', r));
  await assert.rejects(() => loadEvents(`http://127.0.0.1:${bad.address().port}/`, { now: NOW }), /didn't return a calendar/);
  srv.close(); bad.close();
  console.log('calendar tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
