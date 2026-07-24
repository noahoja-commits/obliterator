/* Vercel serverless function  —  deploy at /api/ai
   Holds the API key server-side so it never reaches the browser.
   Set ANTHROPIC_API_KEY in your host's environment variables. */

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2000;
const MAX_PROMPT_CHARS = 8000;   // this app sends one short prompt; nothing legitimate is bigger
const RATE_MAX = 20;             // requests per IP per window
const RATE_WINDOW_MS = 60_000;

/* Best-effort burst limiter. Serverless instances are recycled and run in
   parallel, so this only catches bursts that land on one warm instance — a
   speed bump, not a guarantee. The origin check below does the real work. */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + RATE_WINDOW_MS }); return false; }
  if (hits.size > 5000) hits.clear();   // crude ceiling so a warm instance can't grow unbounded
  rec.n++;
  return rec.n > RATE_MAX;
}

/* Only serve the page this function was deployed alongside. Browsers always send
   Origin on a POST, so a request without one is not coming from the app. This
   stops drive-by use and anyone embedding the endpoint in their own page; it does
   not stop a handcrafted curl, which no origin check can. */
function sameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  let h;
  try { h = new URL(src).host; } catch (e) { return false; }
  const allow = process.env.ALLOWED_ORIGIN;           // optional explicit override
  if (allow) { try { return h === new URL(allow).host; } catch (e) { return h === allow; } }
  return h === host;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: { message: 'POST only' } });

  if (!sameOrigin(req)) return res.status(403).json({ error: { message: 'forbidden' } });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: { message: 'slow down' } });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not set on the server' } });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Only ever forward what this app needs. Never proxy arbitrary fields.
    const messages = Array.isArray(body?.messages) ? body.messages.slice(-4) : [];
    if (!messages.length) return res.status(400).json({ error: { message: 'no messages' } });

    const chars = messages.reduce((a, m) => a + String((m && m.content) || '').length, 0);
    if (chars > MAX_PROMPT_CHARS) return res.status(413).json({ error: { message: 'prompt too long' } });

    const safe = {
      model: MODEL,
      max_tokens: Math.min(Number(body?.max_tokens) || 900, MAX_TOKENS),
      messages
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(safe)
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: { message: String(e && e.message || e) } });
  }
}
