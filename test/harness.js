/* Loads the real index.html in jsdom, stubs only what a headless DOM lacks
   (canvas 2d context, Web Audio, rAF), and exposes the app's globals so tests
   can drive focusAcquire / tickFocus / persist / restoreSession for real. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = path.join(__dirname, '..', 'index.html');

function stubCtx() {
  const noop = () => {};
  /* createImageData has to return something real: the planet raytrace writes
     straight into .data by index. Everything else can be a no-op. */
  const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 800, height: 600 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient')
        return () => ({ addColorStop: noop });
      if (k === 'createImageData') return (w, h) => img(w, h === undefined ? w : h);
      if (k === 'getImageData') return (x, y, w, h) => img(w || 1, h || 1);
      if (typeof t[k] === 'undefined') return noop;
      return t[k];
    },
    set() { return true; }
  });
  return ctx;
}

/* opts:
     storage  seed localStorage with a saved state object
     now      starting value for the controllable clock
     render   give the scene canvas a real size, so frame() stops bailing on !W
              and the whole draw path (starfield, raytraced planet, station,
              beam) actually executes. Off by default: it is genuinely
              expensive, and only the render tests need it.
     env      called with `win` inside beforeParse, for per-test stubs
              (navigator.wakeLock, navigator.onLine, window.confirm, ...) */
async function boot({ storage = null, now = Date.now(), render = false, env = null } = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://obliterator.vercel.app/',
    virtualConsole: vc,
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = stubCtx;
      win.AudioContext = win.webkitAudioContext = function () { throw new Error('no audio'); };
      /* Real rAF, on a timer. The app's frame() bails on `!W` and jsdom reports
         a zero-width canvas, so without a viewport the loop costs nothing — but
         anything else driven by rAF (the fire hold) actually runs.
         With a viewport (render:true) each frame runs the software raytrace,
         which is heavy; firing it every 16ms starves Node's timers and makes
         the app's own setTimeout-scheduled stages drift. The app caps itself to
         30fps when idle anyway, so a 40ms rAF loses nothing visible and leaves
         the event loop free for the timers the tests are watching. */
      const rafMs = render ? 40 : 16;
      win.requestAnimationFrame = fn => win.setTimeout(() => fn(win.performance.now()), rafMs);
      win.cancelAnimationFrame = id => win.clearTimeout(id);
      win.__OBLITERATOR_TEST__ = true;   // unlocks the app's window.__app test hook
      if (storage) win.localStorage.setItem('obliterator:state', JSON.stringify(storage));
      win.__now = now;
      const RealDate = win.Date;
      // controllable clock so we can fast-forward without waiting
      class FakeDate extends RealDate {
        constructor(...a) { if (!a.length) super(win.__now); else super(...a); }
        static now() { return win.__now; }
      }
      win.Date = FakeDate;
      if (render) {
        // jsdom gives every element a 0x0 box; the scene canvas needs a real one
        win.HTMLCanvasElement.prototype.getBoundingClientRect =
          () => ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 });
      }
      if (env) env(win);
    }
  });

  const win = dom.window;
  /* The boot sequence runs on a 165ms interval. Waiting a flat 3.5s for it was
     flaky under load — several pages animating at once starve the timers and a
     suite that passes alone fails in a batch. Wait for the actual signal.

     S.booted is NOT the signal: it flips 700ms before runBoot's callback, and
     that callback is what restores the saved session. The overlay being hidden
     is set on the same tick as the callback, so wait for that, then yield. */
  const done = () => {
    const b = win.document.getElementById('boot');
    return win.__app && win.__app.S.booted && b && b.style.display === 'none';
  };
  const deadline = Date.now() + 30000;
  while (!done() && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  if (!done())
    throw new Error('app never finished booting (30s): ' + (errors[0] || 'no script error reported'));
  await new Promise(r => setTimeout(r, 50));   // let the boot callback's own work land
  /* close() stops this page's intervals and rAF loop. Without it, every page a
     suite boots keeps running and later timing assertions starve. */
  return { dom, win, errors,
    advance: ms => { win.__now += ms; },
    close: () => { try { win.close(); } catch (e) {} } };
}

const saved = win => JSON.parse(win.localStorage.getItem('obliterator:state') || 'null');

module.exports = { boot, saved };
