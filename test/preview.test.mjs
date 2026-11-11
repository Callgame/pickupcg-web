// node --test   (no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clip, crewPreview, embedData, escapeHtml, FALLBACK_CREW, FALLBACK_GAME, gamePreview, headTags,
  IMG_BRAND, IMG_INVITE, injectHead, jsonForScript, sportLabel, whenParts,
} from '../lib/preview.mjs';

// Wed Nov 11 2026, 7:00 PM in New York (UTC-5) = 00:00 UTC Thu.
const START_NY = '2026-11-12T00:00:00Z';
const NOW = Date.parse('2026-11-11T15:00:00Z');

const publicGame = (over = {}) => ({
  status: 200,
  body: {
    ok: true,
    game: {
      title: "Sam's Tuesday run", sport: 'pickleball', day: 'Today', time: '7:00 PM',
      location: 'Bergeron Park', spotsLeft: 3, startsAt: START_NY, state: 'upcoming', rsvpOpen: true,
      access: 'public', maxSpots: 8, fee: 0, hostName: 'Sam R.', hostRef: 'x', going: ['Ana P.'],
      goingMore: 0, guestCount: 1, final: null, ...over,
    },
  },
});
const limitedGame = (over = {}) => ({
  status: 200,
  body: {
    ok: true,
    game: {
      title: 'Acme Eng vs Sales', sport: 'basketball', day: 'Tue', time: '7:00 PM',
      location: '1 Acme Plaza, Floor 3 gym', spotsLeft: 4, startsAt: START_NY, state: 'upcoming',
      rsvpOpen: true, access: 'limited', ...over,
    },
  },
});

test('public upcoming: time, sport, place; count and host', () => {
  const p = gamePreview(publicGame(), NOW);
  assert.equal(p.title, 'Wed 7:00 PM · Pickleball · Bergeron Park');
  assert.equal(p.description, '6 of 8 in · hosted by Sam R.');
  assert.equal(p.image, IMG_INVITE);
});

test('the count includes web guests and never passes capacity', () => {
  assert.match(gamePreview(publicGame({ spotsLeft: 0, guestCount: 3 }), NOW).description, /^8 of 8 in/);
  assert.match(gamePreview(publicGame({ spotsLeft: 8, guestCount: 0 }), NOW).description, /^8 spots open/);
  assert.equal(gamePreview(publicGame({ maxSpots: 0, hostName: null }), NOW).description, FALLBACK_GAME.description);
});

test('relative day labels never reach the preview (they stop being true)', () => {
  const p = gamePreview(publicGame({ startsAt: null, day: 'Today' }), NOW);
  assert.equal(p.title, '7:00 PM · Pickleball · Bergeron Park');
  assert.doesNotMatch(p.title + p.description, /Today|Tomorrow/);
});

test('a game more than six days out carries its date', () => {
  const p = gamePreview(publicGame({ startsAt: '2026-11-26T00:00:00Z' }), NOW);
  assert.equal(p.title, 'Wed Nov 25, 7:00 PM · Pickleball · Bergeron Park');
});

test('played public game with a final: the result, not an invitation', () => {
  const p = gamePreview(publicGame({ state: 'played', rsvpOpen: false, final: { high: 21, low: 18 } }), NOW);
  assert.equal(p.title, 'Final 21–18 · Pickleball · Bergeron Park');
  assert.equal(p.description, 'Played Wed Nov 11 · hosted by Sam R.');
  assert.equal(p.image, IMG_BRAND);
  assert.doesNotMatch(p.title + p.description, /invite/i);
});

test('played public game without a score', () => {
  const p = gamePreview(publicGame({ state: 'played', rsvpOpen: false }), NOW);
  assert.equal(p.title, 'Played Wed Nov 11 · Pickleball · Bergeron Park');
  assert.equal(p.description, 'Hosted by Sam R. · see how it went on Pickup');
  assert.equal(p.image, IMG_BRAND);
});

test('a final logged inside the live window already previews as the result', () => {
  const p = gamePreview(publicGame({ state: 'live', final: { high: 11, low: 7 } }), NOW);
  assert.equal(p.title, 'Final 11–7 · Pickleball · Bergeron Park');
  assert.equal(p.image, IMG_BRAND);
});

test('only game-guest\'s own 404 means gone; a gateway 404 is a failure', () => {
  assert.deepEqual(gamePreview({ status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } }, NOW), FALLBACK_GAME);
  assert.deepEqual(gamePreview({ status: 404, body: { state: 'cancelled' } }, NOW), FALLBACK_GAME);
});

test('cancelled says so, with nothing else', () => {
  const p = gamePreview({ status: 404, body: { ok: false, error: 'not found', state: 'cancelled' } }, NOW);
  assert.equal(p.title, 'This game was cancelled');
  assert.equal(p.image, IMG_BRAND);
  const gone = gamePreview({ status: 404, body: { ok: false, error: 'not found' } }, NOW);
  assert.equal(gone.title, 'This game is no longer available');
});

// The privacy core: a limited (private or workplace) game shows the sport and nothing else.
const FORBIDDEN = ['Acme', 'Eng', 'Sales', 'Plaza', 'Floor', 'gym', '7:00', 'Tue', 'Wed', 'Nov', 'Sam', 'R.', '21', '18', 'hosted', 'spots', ' of '];
for (const [name, reply] of [
  ['limited upcoming', limitedGame()],
  ['limited live', limitedGame({ state: 'live' })],
  ['limited played', limitedGame({ state: 'played', rsvpOpen: false })],
  // Even if a reply ever carried public-only fields for a limited game, they are not used.
  ['limited with stray fields', limitedGame({ hostName: 'Sam R.', going: ['Sam R.'], maxSpots: 8, final: { high: 21, low: 18 } })],
  ['limited played with stray score', limitedGame({ state: 'played', final: { high: 21, low: 18 }, hostName: 'Sam R.' })],
]) {
  test(`${name}: no names, place, time or score`, () => {
    const p = gamePreview(reply, NOW);
    const text = `${p.title} ${p.description}`;
    for (const word of FORBIDDEN) assert.ok(!text.includes(word), `"${word}" leaked into: ${text}`);
    assert.match(p.title, /basketball/);
  });
}

test('fails closed: no access field (an older game-guest) is treated as limited', () => {
  const r = publicGame();
  delete r.body.game.access;
  const p = gamePreview(r, NOW);
  assert.doesNotMatch(`${p.title} ${p.description}`, /Bergeron|Sam|7:00/);
  for (const access of ['PUBLIC', 'Public', '', null, 'public ']) {
    const q = gamePreview(publicGame({ access }), NOW);
    assert.doesNotMatch(`${q.title} ${q.description}`, /Bergeron|Sam/, `access=${access}`);
  }
});

test('unknown or failed replies fall back to the old static invite', () => {
  assert.deepEqual(gamePreview(null, NOW), FALLBACK_GAME);
  assert.deepEqual(gamePreview({ status: 500, body: { ok: false } }, NOW), FALLBACK_GAME);
  assert.deepEqual(gamePreview({ status: 200, body: { ok: true } }, NOW), FALLBACK_GAME);
});

test('a private game\'s free-text sport never reaches its preview', () => {
  assert.equal(gamePreview(limitedGame({ sport: 'Sams birthday' }), NOW).title, "You're invited to a game");
  assert.equal(gamePreview(limitedGame({ sport: 'Spikeball' }), NOW).title, "You're invited to a game");
  assert.equal(gamePreview(limitedGame({ sport: 'ultimate' }), NOW).title, "You're invited to an ultimate game");
  assert.equal(gamePreview(limitedGame({ sport: 'ultimate', state: 'played' }), NOW).title, 'An ultimate game on Pickup');
  assert.equal(gamePreview(limitedGame({ sport: '__proto__' }), NOW).title, "You're invited to a game");
  // A public game may show its own words.
  assert.match(gamePreview(publicGame({ sport: 'Spikeball' }), NOW).title, /Spikeball/);
});

test('workplace activity ids and odd sports get no label', () => {
  assert.equal(sportLabel('org:3f2b1c4d-1111-4222-8333-444455556666'), null);
  assert.equal(sportLabel('flagfootball'), 'Flag football');
  assert.equal(sportLabel('spikeball'), 'Spikeball');
  assert.equal(sportLabel('<script>'), null);
  const p = gamePreview(limitedGame({ sport: 'org:3f2b1c4d-1111-4222-8333-444455556666' }), NOW);
  assert.equal(p.title, "You're invited to a game");
});

test('local weekday from starts_at + the host label, across offsets and midnight', () => {
  // 7:00 PM in New York on Wed = 00:00Z Thu
  assert.deepEqual(pick(whenParts('2026-11-12T00:00:00Z', '7:00 PM', 'Today')), ['Wed', 'Nov 11', '7:00 PM']);
  // 9:30 AM in Kolkata (UTC+5:30) on Wed = 04:00Z Wed
  assert.deepEqual(pick(whenParts('2026-11-11T04:00:00Z', '9:30 am', 'Today')), ['Wed', 'Nov 11', '9:30 AM']);
  // 11:00 PM in Los Angeles on Sat = 07:00Z Sun
  assert.deepEqual(pick(whenParts('2026-11-15T07:00:00Z', '11 PM', 'Today')), ['Sat', 'Nov 14', '11:00 PM']);
  // 6:00 AM in Auckland (UTC+13) on Thu = 17:00Z Wed
  assert.deepEqual(pick(whenParts('2026-11-11T17:00:00Z', '6:00 AM', 'Today')), ['Thu', 'Nov 12', '6:00 AM']);
  // 8:00 PM in Honolulu (UTC-10) on Wed = 06:00Z Thu (not UTC+14 on Thu)
  assert.deepEqual(pick(whenParts('2026-11-12T06:00:00Z', '8:00 PM', 'Today')), ['Wed', 'Nov 11', '8:00 PM']);
  // 5:00 PM in Chicago in July (UTC-5, daylight time) on Sat = 22:00Z Sat
  assert.deepEqual(pick(whenParts('2026-07-11T22:00:00Z', '5:00 PM', 'Today')), ['Sat', 'Jul 11', '5:00 PM']);
  // legacy labels
  assert.deepEqual(pick(whenParts(null, '7:00 PM', 'Sat Jul 12')), ['Sat', 'Jul 12', '7:00 PM']);
  assert.deepEqual(pick(whenParts(null, '7:00 PM', 'Thursday')), ['Thu', null, '7:00 PM']);
  assert.deepEqual(pick(whenParts(null, 'evening', 'Tomorrow')), [null, null, null]);
});
const pick = (w) => [w.weekday, w.monthDay, w.time];

test('crew previews name public crews only', () => {
  const named = crewPreview({ status: 200, body: { ok: true, crew: { name: 'Tuesday Hoopers', sport: 'basketball', memberCount: 12 } } });
  assert.equal(named.title, 'Join Tuesday Hoopers');
  assert.equal(named.description, 'Basketball crew · 12 members — one tap in the app and you’re in the thread.');
  assert.deepEqual(crewPreview({ status: 404, body: { ok: false } }), FALLBACK_CREW);
  assert.deepEqual(crewPreview(null), FALLBACK_CREW);
});

test('everything written into the head is escaped', () => {
  const evil = publicGame({ location: '"><script>alert(1)</script>', hostName: "<img src=x onerror=alert('x')>" });
  const tags = headTags(gamePreview(evil, NOW), 'https://pickupcg.com/game/x"y');
  assert.doesNotMatch(tags, /<script|<img/);
  assert.match(tags, /&lt;script&gt;/);
  assert.match(tags, /og:url" content="https:\/\/pickupcg.com\/game\/x&quot;y"/);
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('long places are clipped, control characters dropped', () => {
  assert.equal(clip('a\u0000b\n c', 10), 'a b c');
  assert.equal(Array.from(clip('x'.repeat(200), 60)).length, 60);
  const p = gamePreview(publicGame({ location: 'Y'.repeat(300) }), NOW);
  assert.ok(Array.from(p.title).length <= 110);
});

test('injectHead swaps exactly the marked block; embedded JSON cannot close its tag', () => {
  const html = '<head>\n<!-- og:start -->\n<title>old</title>\n<!-- og:end -->\n</head><body></body>';
  const out = injectHead(html, '<title>new</title>');
  assert.match(out, /<title>new<\/title>/);
  assert.doesNotMatch(out, /old/);
  assert.throws(() => injectHead('<head></head>', 'x'));
  const json = jsonForScript({ t: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(json, /<\/script>/i);
  assert.deepEqual(JSON.parse(json), { t: '</script><script>alert(1)</script>' });
  const page = embedData(html, 'game-data', { a: '</script>' });
  assert.equal(page.match(/<\/script>/g).length, 1);
});
