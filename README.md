# The Obliterator — getting it on your devices

Three routes, easiest first. Pick one and stop reading.

---

## Route 1 · Drag and drop (2 minutes, no terminal, no account)

1. Go to **https://app.netlify.com/drop**
2. Drag this whole folder onto the page
3. You get an HTTPS URL immediately

That's a real PWA. Open the URL and install it:

- **Desktop** — install icon in Chrome/Edge's address bar
- **iPhone** — Safari -> Share -> *Add to Home Screen*

Make a free Netlify account when prompted, or the site expires in an hour.

**Want the AI features too?** Still no terminal:
Site settings -> Environment variables -> add `ANTHROPIC_API_KEY` -> Deploys ->
*Trigger deploy*. The included `netlify.toml` and `netlify/functions/ai.js`
wire it up automatically. Key from https://console.anthropic.com

---

## Route 2 · Paste your key into the app (no server at all)

If you'd rather not run any backend, the app can call Anthropic directly from
your browser.

Host the folder anywhere static — Netlify Drop, GitHub Pages, whatever — then
open **Record** in the app and paste your `sk-ant-...` key at the top.

The key is stored only in that browser and sent straight to Anthropic. Nothing
passes through a server of mine or yours.

**The trade-off, plainly:** anyone who can use that browser can read the key out
of local storage. Fine on your own laptop and phone. Not fine on a shared or
work machine. There's a *Clear* button next to it.

---

## Route 3 · Don't deploy anything

Keep using it as a Claude artifact. The AI features already work there with no
key, because Claude authenticates the call for you.

You lose: installability, offline, and the home-screen icon. On iPhone you can
still Share -> Add to Home Screen, but it opens in Safari rather than as a
standalone app.

---

## Which route gives you what

| | Route 1 (drop) | Route 2 (own key) | Route 3 (artifact) |
|---|---|---|---|
| Installs as an app | yes | yes | no |
| Works offline | yes | yes | no |
| Breakdown / Trim | needs env var | yes | yes |
| Terminal needed | no | no | no |
| Key exposed in browser | no | **yes** | no |

Everything except the four AI buttons — timer, objectives, Debt Star, campaign
record, processor, queue, scheduling — works with no key on any route.

---

## Advanced: Vercel or Cloudflare

Only if you want a real pipeline.

    # Vercel — uses api/ai.js
    vercel && vercel env add ANTHROPIC_API_KEY && vercel --prod

    # Cloudflare — uses worker.js
    wrangler pages deploy . --project-name obliterator
    wrangler secret put ANTHROPIC_API_KEY

---

## iPhone caveats (Apple's, not the app's)

**Your data can be wiped.** iOS clears site storage after ~7 days unused.
Installing to the Home Screen helps but isn't a guarantee. The campaign record
is the only thing here that can't be recreated — **export a backup now and
then** from the Record screen. Restore reads it straight back.

**Audio follows the ringer switch.** A silent station means the physical mute
switch is on. Web Audio on iOS is gated by it; no code fixes that reliably.

**Safari only.** Chrome and Firefox on iOS can't install PWAs, and iOS never
shows an install prompt — Share -> Add to Home Screen is the only way.

---

## Redeploying

Bump `CACHE` in `sw.js` (`obliterator-v1` -> `v2`) or installed copies keep
serving the old cached version.

## Tests

    npm --prefix test install     # once - pulls jsdom
    npm --prefix test test        # 231 assertions

Six suites, all driving the real `index.html` inside jsdom (canvas, Web Audio
and the clock are stubbed; nothing else is):

    test.js         timer drift, session persistence, boot restore
    tabs.test.js    focus session surviving the Debt Star tab
    ui.test.js      hold-to-fire, blast guard, dial, drag-reorder, instruments
    upgrades.test.js  frame budget, abort guard, restore guard, wake lock, offline
    fire.test.js    the staged firing sequence, stage by stage and in order
    proxy.test.mjs  api/ai.js - origin gate, payload caps, rate limit, model

The manifest lives in `test/` rather than the repo root on purpose: a root
`package.json` would change how Vercel builds what is otherwise a static site.

`boot({render:true})` gives the scene canvas a real size so the whole draw path
runs; the render tests use it. It is off by default because the raytrace in
software is slow.

Not covered: the swipe-between-stations gesture. jsdom has no real touch, so
that one needs a device. Nor is the wake lock's real effect on a screen -
the tests check that the app asks for and releases it at the right moments.

## Files

    index.html                 the app
    test/                      jsdom regression suite (see above)
    manifest.webmanifest       icons, colours, name, shortcuts
    sw.js                      offline shell
    icons/                     192 / 512 / maskable / apple-touch
    netlify.toml               Route 1 wiring
    netlify/functions/ai.js    Route 1 proxy
    api/ai.js                  Vercel proxy
    worker.js                  Cloudflare proxy
    vercel.json                Vercel headers
