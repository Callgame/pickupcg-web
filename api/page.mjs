// Serves /game/:id and /group/:id (vercel.json rewrites) with link-preview tags written
// from the game or crew itself. The copy and every privacy rule live in lib/preview.mjs;
// this file only fetches and assembles.
//
// Data comes ONLY from the two functions that already answer the web pages, with the
// public anon key, exactly as the browser would call them:
//   game-guest GET ?gameId=        the game card (names/host/score for public games only)
//   crew-peek  GET ?preview=1      a crew's name, for public non-workplace crews only
// Nothing here can see more than an anonymous visitor to the page.
//
// If a lookup fails, the page still loads with the old static tags (and isn't cached).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  backendFor, crewPreview, embedData, FALLBACK_CREW, FALLBACK_GAME, gamePreview, headTags,
  injectHead, isUuid, SITE, useBackend,
} from '../lib/preview.mjs';

const TEMPLATES = {};
function template(name) {
  if (!TEMPLATES[name]) TEMPLATES[name] = readFileSync(path.join(process.cwd(), 'public', name), 'utf8');
  return TEMPLATES[name];
}

async function call(url, anon) {
  try {
    const res = await fetch(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      signal: AbortSignal.timeout(4500),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

function page(html, { cacheable }) {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A short CDN cache absorbs a crawler burst when a link lands in a big group chat;
      // the page's seat count and guest list are never more than 30 seconds old.
      'Cache-Control': cacheable ? 'public, max-age=0, s-maxage=30' : 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

// The function's own answers: 200 { ok: true } or 404 { ok: false }. Anything else (a gateway
// 404 while a function is missing or mid-deploy, a 401, a 5xx, a timeout) is a failure: the
// page gets the static tags, nothing is embedded, nothing is cached.
const answeredBy = (reply) => !!reply && !!reply.body
  && ((reply.status === 200 && reply.body.ok === true) || (reply.status === 404 && reply.body.ok === false));

export async function render(request, env = process.env) {
  const url = new URL(request.url);
  const backend = backendFor(env.VERCEL_ENV, env.PICKUP_PREVIEW_ANON_KEY);
  // The rewrite puts kind and id in the query. A link that carries its own ?id= or ?kind= could
  // make them ambiguous (which one wins is Vercel's call): then preview nothing specific.
  const ambiguous = url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('kind').length > 1;
  const kind = url.searchParams.get('kind');
  const id = ambiguous ? '' : (url.searchParams.get('id') || '').toLowerCase();

  if (kind === 'crew') {
    const reply = isUuid(id)
      ? await call(`${backend.url}/functions/v1/crew-peek?groupId=${encodeURIComponent(id)}&preview=1`, backend.anon)
      : null;
    // A 404 is an answer (private, workplace or gone): cache it. A failed call is not.
    const answered = answeredBy(reply);
    const preview = answered ? crewPreview(reply) : FALLBACK_CREW;
    const html = injectHead(useBackend(template('open.html'), backend), headTags(preview, isUuid(id) ? `${SITE}/group/${id}` : null));
    return page(html, { cacheable: answered });
  }

  // kind=game (the default)
  if (ambiguous) {
    return page(injectHead(useBackend(template('game.html'), backend), headTags(FALLBACK_GAME, null)), { cacheable: false });
  }
  const reply = isUuid(id)
    ? await call(`${backend.url}/functions/v1/game-guest?gameId=${encodeURIComponent(id)}`, backend.anon)
    : { status: 404, body: { ok: false, error: 'not found' } };
  const answered = answeredBy(reply);
  const preview = answered ? gamePreview(reply) : FALLBACK_GAME;
  let html = injectHead(useBackend(template('game.html'), backend), headTags(preview, isUuid(id) ? `${SITE}/game/${id}` : null));
  if (answered && isUuid(id)) html = embedData(html, 'game-data', { gameId: id, status: reply.status, body: reply.body });
  return page(html, { cacheable: answered });
}

export async function GET(request) {
  try {
    return await render(request);
  } catch {
    // Never break the page over a preview: serve the static file (on its environment's backend).
    const kind = new URL(request.url).searchParams.get('kind');
    const html = template(kind === 'crew' ? 'open.html' : 'game.html');
    try {
      return page(useBackend(html, backendFor(process.env.VERCEL_ENV, process.env.PICKUP_PREVIEW_ANON_KEY)), { cacheable: false });
    } catch {
      return page(html, { cacheable: false });
    }
  }
}

export async function HEAD(request) {
  const res = await GET(request);
  return new Response(null, { status: res.status, headers: res.headers });
}
