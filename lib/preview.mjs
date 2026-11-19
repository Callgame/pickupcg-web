// Link previews for game and crew links — the pure half (no network, no files), so
// `node --test` covers every word a crawler will see. api/page.mjs does the I/O.
//
// Why server-side: iMessage, WhatsApp, Slack, Facebook and X build a link's preview
// from the HTML <head> and never run JavaScript, so a static page previews every game
// as the same invitation. The page is now served by a function that writes the
// preview tags from the game itself.
//
// Privacy rules (founder decision 2026-11-11; enforced HERE and, first, in the app
// repo's game-guest function, which returns names only for public games):
//   - PUBLIC games: time, sport, place, how many are in, the host as first name +
//     last initial, and the final score once played.
//   - PRIVATE and ORG (workplace) games: a generic preview, sport only. No title, no
//     place, no time, no names, no score, even though the page shows the link holder
//     more. Previews outlive the person who received the link: they are forwarded,
//     screenshotted and unfurled in work channels.
//   - Anything we can't classify falls back to the generic invite. Never the reverse.
//
// iMessage builds the preview on the sender's phone at send time and keeps it, so the
// copy prefers facts that stay true ("Tue 7:00 PM", not "Today").

export const SITE = 'https://pickupcg.com';
export const IMG_INVITE = `${SITE}/assets/og-game.png`; // "You're invited to a run."
export const IMG_BRAND = `${SITE}/assets/og-home.png`; // neutral brand card

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One line, no control characters, at most `max` characters (with an ellipsis). */
export function clip(s, max) {
  const one = String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(one);
  return chars.length <= max ? one : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

// The app's sport ids (pickup-native constants/sports.ts). Anything else that reads like a
// plain word is title-cased; ids like "org:<uuid>" (workplace activities) get no label.
const SPORT_LABELS = {
  basketball: 'Basketball', pickleball: 'Pickleball', tennis: 'Tennis', soccer: 'Soccer',
  volleyball: 'Volleyball', flagfootball: 'Flag football', running: 'Running', cycling: 'Cycling',
  softball: 'Softball', badminton: 'Badminton', ultimate: 'Ultimate', hockey: 'Hockey',
  lacrosse: 'Lacrosse', wrestling: 'Wrestling', boxing: 'Boxing', crossfit: 'CrossFit',
  yoga: 'Yoga', padel: 'Padel', squash: 'Squash', skateboarding: 'Skateboarding',
};
export function sportLabel(id, { knownOnly = false } = {}) {
  const s = String(id ?? '').trim();
  if (Object.prototype.hasOwnProperty.call(SPORT_LABELS, s.toLowerCase())) return SPORT_LABELS[s.toLowerCase()];
  // A game's sport can be free text the host typed ("Sams birthday"): a private game's
  // preview names only sports from the list.
  if (knownOnly || !/^[a-z][a-z ]{1,23}$/i.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseTime(label) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(String(label ?? ''));
  if (!m) return null;
  const h12 = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h12 < 1 || h12 > 12 || min > 59) return null;
  const pm = /pm/i.test(m[3]);
  return { h24: (h12 % 12) + (pm ? 12 : 0), min, text: `${h12}:${String(min).padStart(2, '0')} ${pm ? 'PM' : 'AM'}` };
}

/**
 * When the game is, in the host's local time. Games store a UTC `starts_at` and the
 * host's own "7:00 PM" label; the difference between the two is the host's UTC
 * offset, which gives the local weekday and date without knowing a time zone. Older
 * games have only labels: a weekday or "Sat Jul 12" is kept, "Today"/"Tomorrow" is
 * dropped (it stops being true).
 */
export function whenParts(startsAt, timeLabel, dayLabel) {
  const t = parseTime(timeLabel);
  const start = startsAt ? Date.parse(startsAt) : NaN;
  if (t && !Number.isNaN(start)) {
    const d = new Date(start);
    // The label only fixes the offset modulo a day, and some pairs of zones share a wall
    // clock a day apart (UTC-10 Hawaii and UTC+14; UTC-11 and UTC+13 New Zealand summer).
    // Keep offsets in (-11h, +13h]: that resolves both pairs toward the populated zone.
    let off = t.h24 * 60 + t.min - (d.getUTCHours() * 60 + d.getUTCMinutes());
    while (off > 13 * 60) off -= 1440;
    while (off <= -11 * 60) off += 1440;
    const local = new Date(start + off * 60000);
    return {
      weekday: WEEKDAYS[local.getUTCDay()],
      monthDay: `${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`,
      time: t.text,
      startMs: start,
    };
  }
  const day = String(dayLabel ?? '').trim();
  const dated = /^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})$/.exec(day);
  let weekday = null;
  let monthDay = null;
  if (dated) {
    const wd = WEEKDAYS.find((w) => w.toLowerCase() === dated[1].toLowerCase());
    const mo = MONTHS.find((m) => m.toLowerCase() === dated[2].toLowerCase());
    if (wd && mo) { weekday = wd; monthDay = `${mo} ${Number(dated[3])}`; }
  } else {
    const i = LONG_DAYS.findIndex((w) => w === day.toLowerCase() || w.slice(0, 3) === day.toLowerCase());
    if (i >= 0) weekday = WEEKDAYS[i];
  }
  return { weekday, monthDay, time: t ? t.text : null, startMs: Number.isNaN(start) ? null : start };
}

const SIX_DAYS = 6 * 24 * 3600 * 1000;

/** "Tue 7:00 PM"; a game more than six days out also gets its date ("Tue Nov 25, 7:00 PM"). */
function upcomingWhen(w, now) {
  const far = w.startMs != null && w.startMs - now > SIX_DAYS;
  const day = w.weekday ? (far && w.monthDay ? `${w.weekday} ${w.monthDay}` : w.weekday) : null;
  if (day && w.time) return far && w.monthDay ? `${day}, ${w.time}` : `${day} ${w.time}`;
  return day || w.time || null;
}
const playedDay = (w) => [w.weekday, w.monthDay].filter(Boolean).join(' ') || null;
const join = (parts) => parts.filter(Boolean).join(' · ');

export const FALLBACK_GAME = {
  title: "You're invited to a pickup game",
  description: "Tap to see the details and say you're in — no account needed.",
  image: IMG_INVITE,
};

/**
 * The preview for /game/:id, from game-guest's GET reply ({ status, body } or null when the
 * call failed). Returns { title, description, image }.
 */
export function gamePreview(reply, now = Date.now()) {
  if (!reply || !reply.body) return FALLBACK_GAME;
  const { status, body } = reply;
  // Only game-guest's own 404 ({ ok: false }) means the game is gone. A gateway 404 (the
  // function missing or mid-deploy) is a failure, and gets the old static invite.
  if (status === 404 && body.ok === false && body.state === 'cancelled') {
    return { title: 'This game was cancelled', description: 'Find another game near you on Pickup.', image: IMG_BRAND };
  }
  if (status === 404 && body.ok === false) {
    return { title: 'This game is no longer available', description: 'Find a game near you on Pickup.', image: IMG_BRAND };
  }
  const g = body.ok ? body.game : null;
  if (status !== 200 || !g) return FALLBACK_GAME;

  const played = g.state === 'played';

  // Fail closed: only an explicit "public" gets details (an older game-guest sends no access).
  if (g.access !== 'public') {
    const known = sportLabel(g.sport, { knownOnly: true });
    const sport = known ? known.toLowerCase() : null;
    if (played) {
      return {
        title: sport ? `${article(sport) === 'an' ? 'An' : 'A'} ${sport} game on Pickup` : 'A game on Pickup',
        description: 'This game has been played. See how it went in the app.',
        image: IMG_BRAND,
      };
    }
    return {
      title: sport ? `You're invited to ${article(sport)} ${sport} game` : "You're invited to a game",
      description: "Private invite — tap to see the details and say you're in.",
      image: IMG_INVITE,
    };
  }

  const sport = sportLabel(g.sport);
  const w = whenParts(g.startsAt, g.time, g.day);
  const place = g.location ? clip(g.location, 60) : null;
  const host = g.hostName ? `hosted by ${clip(g.hostName, 30)}` : null;
  const f = g.final && Number.isFinite(g.final.high) && Number.isFinite(g.final.low) ? g.final : null;

  // Results only once the game is played (two hours after its start). Anyone who joins a public
  // game can type a recap line in its chat, so during the game it never replaces the invite.
  if (played) {
    const day = playedDay(w);
    if (f) {
      return {
        title: clip(join([`Final ${f.high}–${f.low}`, sport, place]), 110),
        description: join([day ? `Played ${day}` : 'Played', host]),
        image: IMG_BRAND,
      };
    }
    return {
      title: clip(join([day ? `Played ${day}` : 'Played', sport, place]), 110),
      description: join([host ? host.charAt(0).toUpperCase() + host.slice(1) : null, 'see how it went on Pickup']),
      image: IMG_BRAND,
    };
  }

  const max = Number(g.maxSpots) || 0;
  const open = Math.max(0, Number(g.spotsLeft) || 0);
  const guests = Math.max(0, Number(g.guestCount) || 0);
  let count = null;
  if (max > 0) {
    const inCount = Math.min(max, Math.max(0, max - open) + guests);
    count = inCount > 0 ? `${inCount} of ${max} in` : `${max} spots open`;
  }
  return {
    title: clip(join([upcomingWhen(w, now), sport, place]) || "You're invited to a pickup game", 110),
    description: join([count, host]) || FALLBACK_GAME.description,
    image: IMG_INVITE,
  };
}

export const FALLBACK_CREW = {
  title: "You're invited to a crew",
  description: 'A friend wants you in their crew on Pickup — rallies, runs, and the group’s games, all in one thread.',
  image: IMG_BRAND,
};

/** The preview for /group/:id, from crew-peek's ?preview=1 reply (public, non-workplace crews only). */
export function crewPreview(reply) {
  const crew = reply && reply.status === 200 && reply.body && reply.body.ok ? reply.body.crew : null;
  if (!crew || !crew.name) return FALLBACK_CREW;
  const sport = sportLabel(crew.sport);
  const n = Number(crew.memberCount) || 0;
  const what = join([sport ? `${sport} crew` : 'A crew', n > 0 ? `${n} member${n === 1 ? '' : 's'}` : null]);
  return {
    title: clip(`Join ${crew.name}`, 90),
    description: `${what} — one tap in the app and you’re in the thread.`,
    image: IMG_BRAND,
  };
}

/** The tags that replace the page's static block (between the og:start/og:end markers). */
export function headTags({ title, description, image }, canonicalUrl) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const i = escapeHtml(image);
  return [
    `<title>${t} — Pickup</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:site_name" content="Pickup" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${i}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:type" content="website" />`,
    canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />` : '',
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${i}" />`,
  ].filter(Boolean).join('\n  ');
}

const START = '<!-- og:start -->';
const END = '<!-- og:end -->';

/** Swap the static preview block for `tags`. Throws if the template lost its markers. */
export function injectHead(html, tags) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error('template is missing the og:start/og:end markers');
  return html.slice(0, a + START.length) + '\n  ' + tags + '\n  ' + html.slice(b);
}

/** JSON for a <script type="application/json"> block: nothing in it can close the tag. */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Put the game-guest reply in the page, so it renders without a second call. */
export function embedData(html, id, value) {
  const tag = `<script id="${id}" type="application/json">${jsonForScript(value)}</script>`;
  const at = html.indexOf('</head>');
  if (at < 0) throw new Error('template has no </head>');
  return html.slice(0, at) + '  ' + tag + '\n' + html.slice(at);
}

// Which Supabase the pages talk to. Production serves pickupcg.com; every other Vercel
// environment (preview deploys of pull requests, `vercel dev`) talks to STAGING, so a
// preview never writes guest RSVPs into the live database. The production anon key has
// always been in these pages (public by design; RLS is the protection). Staging's key is
// NOT in this public repo: game-guest needs no key (verify_jwt off), so previews work
// without one. Set PICKUP_PREVIEW_ANON_KEY (Vercel → Settings → Environment Variables,
// Preview only) to also get named crews and the page's referral beacon on previews.
export const PRODUCTION = {
  url: 'https://pqwdmstmxwntuyityxin.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxd2Rtc3RteHdudHV5aXR5eGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzODg0NDMsImV4cCI6MjA5Mzk2NDQ0M30.0l5dxQzu2XjCA09DV35b4VS8nwXDFpJbY03o5bvhHUE',
};
export const STAGING_URL = 'https://trczpzgnbfgnksghbjzs.supabase.co';
export function backendFor(vercelEnv, previewAnonKey = '') {
  if (vercelEnv === 'preview' || vercelEnv === 'development') {
    return { url: STAGING_URL, anon: publicKeyOrNothing(previewAnonKey), staging: true };
  }
  return PRODUCTION;
}

/** The key is written into public page HTML, so only a public one is used: a legacy JWT whose
 *  role is "anon", or a new-style publishable key. Anything else (a service key set by mistake)
 *  is ignored, and the preview runs keyless. */
export function publicKeyOrNothing(key) {
  const k = String(key || '').trim();
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(k)) return k;
  const parts = k.split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload && payload.role === 'anon' ? k : '';
  } catch {
    return '';
  }
}

/** Point the page's own script at `backend` (the pages carry the production values). */
export function useBackend(html, backend) {
  if (backend === PRODUCTION) return html;
  const out = html.split(PRODUCTION.anon).join(backend.anon).split(PRODUCTION.url).join(backend.url);
  if (out.includes(PRODUCTION.url) || out.includes(PRODUCTION.anon)) throw new Error('production values left in a non-production page');
  return out;
}
