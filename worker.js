/* Cloudflare Worker variant — bind as a route on /api/ai
   Add the key with:  npx wrangler secret put ANTHROPIC_API_KEY   */

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2000;
const MAX_PROMPT_CHARS = 8000;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;

/* Best-effort only — isolates are per-colo and recycled, so this catches bursts
   on one isolate, nothing more. The origin check is the real gate. For a hard
   limit, put Cloudflare's own Rate Limiting rules in front of the route. */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + RATE_WINDOW_MS }); return false; }
  if (hits.size > 5000) hits.clear();
  rec.n++;
  return rec.n > RATE_MAX;
}

/* Browsers always send Origin on a POST, so no Origin means it isn't the app.
   Blocks drive-by use and embedding; a handcrafted curl is out of scope. */
function sameOrigin(request, env) {
  const host = new URL(request.url).host;
  const src = request.headers.get('origin') || request.headers.get('referer');
  if (!src) return false;
  let h;
  try { h = new URL(src).host; } catch (e) { return false; }
  if (env.ALLOWED_ORIGIN) {
    try { return h === new URL(env.ALLOWED_ORIGIN).host; } catch (e) { return h === env.ALLOWED_ORIGIN; }
  }
  return h === host;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/api/ai')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (request.method !== 'POST')   return json({ error: { message: 'POST only' } }, 405);

    if (!sameOrigin(request, env))   return json({ error: { message: 'forbidden' } }, 403);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (rateLimited(ip))             return json({ error: { message: 'slow down' } }, 429);

    if (!env.ANTHROPIC_API_KEY)      return json({ error: { message: 'ANTHROPIC_API_KEY not set' } }, 500);

    try {
      const body = await request.json();
      const messages = Array.isArray(body?.messages) ? body.messages.slice(-4) : [];
      if (!messages.length) return json({ error: { message: 'no messages' } }, 400);

      const chars = messages.reduce((a, m) => a + String(m?.content || '').length, 0);
      if (chars > MAX_PROMPT_CHARS) return json({ error: { message: 'prompt too long' } }, 413);

      const safe = {
        model: MODEL,
        max_tokens: Math.min(Number(body?.max_tokens) || 900, MAX_TOKENS),
        messages
      };

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(safe)
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { 'content-type': 'application/json' }
      });
    } catch (e) {
      return json({ error: { message: String(e && e.message || e) } }, 500);
    }
  }
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
