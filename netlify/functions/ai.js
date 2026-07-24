/* Netlify Function — lands at /.netlify/functions/ai
   netlify.toml redirects /api/ai to it, so the app finds it unchanged.
   Set ANTHROPIC_API_KEY in Site settings -> Environment variables (browser, no CLI). */

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2000;
const MAX_PROMPT_CHARS = 8000;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;

/* Best-effort only — instances are recycled and run in parallel, so this catches
   bursts on a warm instance, nothing more. The origin check is the real gate. */
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
function sameOrigin(request) {
  const host = new URL(request.url).host;
  const src = request.headers.get('origin') || request.headers.get('referer');
  if (!src) return false;
  let h;
  try { h = new URL(src).host; } catch (e) { return false; }
  const allow = Netlify.env.get('ALLOWED_ORIGIN');
  if (allow) { try { return h === new URL(allow).host; } catch (e) { return h === allow; } }
  return h === host;
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST')
    return Response.json({ error: { message: 'POST only' } }, { status: 405 });

  if (!sameOrigin(request)) return Response.json({ error: { message: 'forbidden' } }, { status: 403 });

  const ip = (request.headers.get('x-nf-client-connection-ip')
    || String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown');
  if (rateLimited(ip)) return Response.json({ error: { message: 'slow down' } }, { status: 429 });

  const key = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!key) return Response.json({ error: { message: 'ANTHROPIC_API_KEY not set' } }, { status: 500 });

  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages.slice(-4) : [];
    if (!messages.length) return Response.json({ error: { message: 'no messages' } }, { status: 400 });

    const chars = messages.reduce((a, m) => a + String(m?.content || '').length, 0);
    if (chars > MAX_PROMPT_CHARS) return Response.json({ error: { message: 'prompt too long' } }, { status: 413 });

    const safe = {
      model: MODEL,
      max_tokens: Math.min(Number(body?.max_tokens) || 900, MAX_TOKENS),
      messages
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(safe)
    });
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return Response.json({ error: { message: String(e?.message || e) } }, { status: 500 });
  }
};
