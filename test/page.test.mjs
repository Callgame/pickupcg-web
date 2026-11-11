// The handler end to end, with game-guest / crew-peek answered by a stub (no network).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../api/page.mjs';
import { PRODUCTION, STAGING } from '../lib/preview.mjs';

const ID = '3f2b1c4d-1111-4222-8333-444455556666';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers });
    const r = handler(String(url));
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}
const req = (qs) => new Request(`https://pickupcg.com/api/page?${qs}`);
const head = (html) => html.slice(0, html.indexOf('</head>'));
const meta = (html, prop) => {
  const m = new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html);
  return m && m[1];
};

const PUBLIC = {
  status: 200,
  body: { ok: true, game: {
    title: 'Run', sport: 'basketball', day: 'Tue', time: '7:00 PM', location: 'Bergeron Park', spotsLeft: 4,
    startsAt: '2026-11-12T00:00:00Z', state: 'upcoming', rsvpOpen: true, access: 'public', maxSpots: 10,
    fee: 0, hostName: 'Sam R.', hostRef: 'h', going: ['Ana P.'], goingMore: 0, guestCount: 0, final: null,
  } },
};

test('production: a public game gets its own tags, the reply is embedded, the page is cached briefly', async () => {
  const calls = stub(() => PUBLIC);
  const res = await render(req(`kind=game&id=${ID}`), { VERCEL_ENV: 'production' });
  const html = await res.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PRODUCTION.url}/functions/v1/game-guest?gameId=${ID}`);
  assert.equal(meta(html, 'og:title'), 'Wed 7:00 PM · Basketball · Bergeron Park');
  assert.equal(meta(html, 'og:description'), '6 of 10 in · hosted by Sam R.');
  assert.equal(meta(html, 'twitter:title'), 'Wed 7:00 PM · Basketball · Bergeron Park');
  assert.equal(meta(html, 'og:url'), `https://pickupcg.com/game/${ID}`);
  assert.equal((head(html).match(/property="og:title"/g) || []).length, 1, 'exactly one og:title');
  assert.match(html, /<script id="game-data" type="application\/json">/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=30');
  assert.ok(html.includes(PRODUCTION.anon) && !html.includes(STAGING.url));
});

test('preview deploys talk to staging, in the function and in the page script', async () => {
  const calls = stub(() => PUBLIC);
  const html = await (await render(req(`kind=game&id=${ID}`), { VERCEL_ENV: 'preview' })).text();
  assert.ok(calls[0].url.startsWith(`${STAGING.url}/functions/v1/game-guest`));
  assert.ok(html.includes(STAGING.url) && html.includes(STAGING.anon));
  assert.ok(!html.includes(PRODUCTION.url) && !html.includes(PRODUCTION.anon));
});

test('an unset VERCEL_ENV is production, never staging', async () => {
  const calls = stub(() => PUBLIC);
  await render(req(`kind=game&id=${ID}`), {});
  assert.ok(calls[0].url.startsWith(PRODUCTION.url));
});

test('a limited game: generic tags, still embedded for the link holder\'s page', async () => {
  stub(() => ({ status: 200, body: { ok: true, game: {
    title: 'Acme Eng vs Sales', sport: 'basketball', day: 'Tue', time: '7:00 PM', location: 'Acme HQ gym',
    spotsLeft: 4, startsAt: '2026-11-12T00:00:00Z', state: 'upcoming', rsvpOpen: true, access: 'limited',
  } } }));
  const html = await (await render(req(`kind=game&id=${ID}`), { VERCEL_ENV: 'production' })).text();
  const h = head(html).split('<script id="game-data"')[0];
  assert.equal(meta(html, 'og:title'), 'You&#39;re invited to a basketball game');
  for (const w of ['Acme', 'Sales', 'gym', '7:00']) assert.ok(!h.includes(w), `${w} in the preview tags`);
});

test('a malformed id never calls out and reads as gone', async () => {
  const calls = stub(() => PUBLIC);
  const html = await (await render(req('kind=game&id=../../etc'), { VERCEL_ENV: 'production' })).text();
  assert.equal(calls.length, 0);
  assert.equal(meta(html, 'og:title'), 'This game is no longer available');
  assert.ok(!html.includes('id="game-data"'));
});

test('a failed lookup serves the static invite and is not cached', async () => {
  stub(() => new Error('timeout'));
  const res = await render(req(`kind=game&id=${ID}`), { VERCEL_ENV: 'production' });
  const html = await res.text();
  assert.equal(meta(html, 'og:title'), 'You&#39;re invited to a pickup game');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(!html.includes('id="game-data"'));
  stub(() => ({ status: 502, body: { message: 'bad gateway' } }));
  const res2 = await render(req(`kind=game&id=${ID}`), { VERCEL_ENV: 'production' });
  assert.equal(res2.headers.get('cache-control'), 'no-store');
});

test('crew links ask crew-peek in preview mode and never pass the invite code', async () => {
  const calls = stub(() => ({ status: 200, body: { ok: true, crew: { name: 'Tuesday Hoopers', sport: 'basketball', memberCount: 9 } } }));
  const html = await (await render(new Request(`https://pickupcg.com/api/page?kind=crew&id=${ID}&code=SECRET1`), { VERCEL_ENV: 'production' })).text();
  assert.equal(calls[0].url, `${PRODUCTION.url}/functions/v1/crew-peek?groupId=${ID}&preview=1`);
  assert.ok(!calls[0].url.includes('SECRET1'));
  assert.equal(meta(html, 'og:title'), 'Join Tuesday Hoopers');
  stub(() => ({ status: 404, body: { ok: false } }));
  const generic = await (await render(req(`kind=crew&id=${ID}`), { VERCEL_ENV: 'production' })).text();
  assert.equal(meta(generic, 'og:title'), 'You&#39;re invited to a crew');
});
