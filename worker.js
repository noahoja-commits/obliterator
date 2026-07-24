/* Cloudflare Worker variant — bind as a route on /api/ai
   Add the key with:  npx wrangler secret put ANTHROPIC_API_KEY   */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/api/ai')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (request.method !== 'POST')   return json({ error: { message: 'POST only' } }, 405);
    if (!env.ANTHROPIC_API_KEY)      return json({ error: { message: 'ANTHROPIC_API_KEY not set' } }, 500);

    try {
      const body = await request.json();
      const safe = {
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(Number(body?.max_tokens) || 900, 2000),
        messages: Array.isArray(body?.messages) ? body.messages.slice(-4) : []
      };
      if (!safe.messages.length) return json({ error: { message: 'no messages' } }, 400);

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
