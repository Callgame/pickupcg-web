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
      signal: AbortSignal.timeout(3000),
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

export async function render(request, env = process.env) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id') || '';
  const backend = backendFor(env.VERCEL_ENV);

  if (kind === 'crew') {
    const reply = isUuid(id)
      ? await call(`${backend.url}/functions/v1/crew-peek?groupId=${encodeURIComponent(id)}&preview=1`, backend.anon)
      : null;
    // A 404 is an answer (private, workplace or gone): cache it. A failed call is not.
    const preview = reply ? crewPreview(reply) : FALLBACK_CREW;
    const html = injectHead(useBackend(template('open.html'), backend), headTags(preview, isUuid(id) ? `${SITE}/group/${id}` : null));
    return page(html, { cacheable: !!reply });
  }

  // kind=game (the default)
  const reply = isUuid(id)
    ? await call(`${backend.url}/functions/v1/game-guest?gameId=${encodeURIComponent(id)}`, backend.anon)
    : { status: 404, body: { ok: false, error: 'not found' } };
  const answered = !!reply && (reply.status === 200 || reply.status === 404) && !!reply.body;
  const preview = answered ? gamePreview(reply) : FALLBACK_GAME;
  let html = injectHead(useBackend(template('game.html'), backend), headTags(preview, isUuid(id) ? `${SITE}/game/${id}` : null));
  if (answered && isUuid(id)) html = embedData(html, 'game-data', { gameId: id, status: reply.status, body: reply.body });
  return page(html, { cacheable: answered });
}

export async function GET(request) {
  try {
    return await render(request);
  } catch {
    // Never break the page over a preview: serve the static file as it always was.
    const kind = new URL(request.url).searchParams.get('kind');
    return page(template(kind === 'crew' ? 'open.html' : 'game.html'), { cacheable: false });
  }
}

export async function HEAD(request) {
  const res = await GET(request);
  return new Response(null, { status: res.status, headers: res.headers });
}
