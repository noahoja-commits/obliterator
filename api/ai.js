/* Vercel / Netlify serverless function  —  deploy at /api/ai
   Holds the API key server-side so it never reaches the browser.
   Set ANTHROPIC_API_KEY in your host's environment variables. */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: { message: 'POST only' } });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not set on the server' } });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Only ever forward what this app needs. Never proxy arbitrary fields.
    const safe = {
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(Number(body?.max_tokens) || 900, 2000),
      messages: Array.isArray(body?.messages) ? body.messages.slice(-4) : []
    };
    if (!safe.messages.length) return res.status(400).json({ error: { message: 'no messages' } });

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
