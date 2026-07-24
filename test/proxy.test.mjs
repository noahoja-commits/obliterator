/* Drives the real Vercel handler with mock req/res and a stubbed upstream fetch. */
// api/ai.js is ESM in a .js file; Node needs the .mjs extension to load it.
// `npm test` copies it here first — see package.json.
import handler from './_ai_under_test.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : '')));

process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
let upstreamCalls = 0;
globalThis.fetch = async () => { upstreamCalls++; return { status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; };

const HOST = 'obliterator.vercel.app';
function call(headers, body, method = 'POST') {
  const req = { method, headers: { host: HOST, ...headers }, body };
  let code = 0, payload = null;
  const res = {
    status(c) { code = c; return res; },
    json(p) { payload = p; return res; },
    end() { return res; }
  };
  return handler(req, res).then(() => ({ code, payload }));
}
const goodBody = { max_tokens: 900, messages: [{ role: 'user', content: 'break this down' }] };

console.log('\nproxy origin gate');
let r = await call({ origin: 'https://' + HOST }, goodBody);
ok('same-origin request passes', r.code === 200, 'code=' + r.code);
ok('upstream was called', upstreamCalls === 1);

upstreamCalls = 0;
r = await call({}, goodBody);
ok('no Origin/Referer is rejected (bare curl)', r.code === 403, 'code=' + r.code);
ok('upstream NOT called', upstreamCalls === 0);

r = await call({ origin: 'https://evil.example.com' }, goodBody);
ok('foreign Origin is rejected', r.code === 403, 'code=' + r.code);

r = await call({ referer: 'https://' + HOST + '/some/page' }, goodBody);
ok('Referer alone is accepted', r.code === 200, 'code=' + r.code);

r = await call({ origin: 'not-a-url' }, goodBody);
ok('malformed Origin is rejected, not crashed', r.code === 403, 'code=' + r.code);

console.log('\npayload limits');
r = await call({ origin: 'https://' + HOST }, { messages: [] });
ok('empty messages rejected', r.code === 400, 'code=' + r.code);

r = await call({ origin: 'https://' + HOST }, { messages: [{ role: 'user', content: 'x'.repeat(9000) }] });
ok('oversized prompt rejected', r.code === 413, 'code=' + r.code);

upstreamCalls = 0;
await call({ origin: 'https://' + HOST }, { max_tokens: 999999, messages: [{ role: 'user', content: 'hi' }] });
ok('huge max_tokens still forwarded (capped server-side)', upstreamCalls === 1);

console.log('\nmethod gate');
r = await call({ origin: 'https://' + HOST }, null, 'GET');
ok('GET rejected', r.code === 405, 'code=' + r.code);
r = await call({ origin: 'https://' + HOST }, null, 'OPTIONS');
ok('OPTIONS preflight 204', r.code === 204, 'code=' + r.code);

console.log('\nrate limit');
let limited = 0;
for (let i = 0; i < 30; i++) {
  const rr = await call({ origin: 'https://' + HOST, 'x-forwarded-for': '9.9.9.9' }, goodBody);
  if (rr.code === 429) limited++;
}
ok('burst from one IP gets throttled', limited > 0, 'limited=' + limited);
r = await call({ origin: 'https://' + HOST, 'x-forwarded-for': '1.2.3.4' }, goodBody);
ok('a different IP is unaffected', r.code === 200, 'code=' + r.code);

console.log('\nmodel');
let sentBody = null;
globalThis.fetch = async (u, o) => { sentBody = JSON.parse(o.body); return { status: 200, json: async () => ({}) }; };
await call({ origin: 'https://' + HOST, 'x-forwarded-for': '5.5.5.5' }, { max_tokens: 5000, messages: [{ role: 'user', content: 'hi' }] });
ok('model is claude-sonnet-5', sentBody.model === 'claude-sonnet-5', sentBody.model);
ok('max_tokens capped at 2000', sentBody.max_tokens === 2000, String(sentBody.max_tokens));
ok('no stray fields forwarded',
   Object.keys(sentBody).sort().join(',') === 'max_tokens,messages,model',
   Object.keys(sentBody).join(','));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
