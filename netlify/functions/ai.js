/* Netlify Function — lands at /.netlify/functions/ai
   netlify.toml redirects /api/ai to it, so the app finds it unchanged.
   Set ANTHROPIC_API_KEY in Site settings -> Environment variables (browser, no CLI). */

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST')
    return Response.json({ error: { message: 'POST only' } }, { status: 405 });

  const key = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!key) return Response.json({ error: { message: 'ANTHROPIC_API_KEY not set' } }, { status: 500 });

  try {
    const body = await request.json();
    const safe = {
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(Number(body?.max_tokens) || 900, 2000),
      messages: Array.isArray(body?.messages) ? body.messages.slice(-4) : []
    };
    if (!safe.messages.length) return Response.json({ error: { message: 'no messages' } }, { status: 400 });

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
