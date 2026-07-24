/* Loads the real index.html in jsdom, stubs only what a headless DOM lacks
   (canvas 2d context, Web Audio, rAF), and exposes the app's globals so tests
   can drive focusAcquire / tickFocus / persist / restoreSession for real. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = path.join(__dirname, '..', 'index.html');

function stubCtx() {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 800, height: 600 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient')
        return () => ({ addColorStop: noop });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (typeof t[k] === 'undefined') return noop;
      return t[k];
    },
    set() { return true; }
  });
  return ctx;
}

async function boot({ storage = null, now = Date.now() } = {}) {
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
         a zero-width canvas, so the render loop costs nothing — but anything
         else driven by rAF (the fire hold) actually runs. */
      win.requestAnimationFrame = fn => win.setTimeout(() => fn(win.performance.now()), 16);
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
    }
  });

  const win = dom.window;
  // boot sequence runs on a 165ms interval; let it finish
  await new Promise(r => setTimeout(r, 3500));
  /* close() stops this page's intervals and rAF loop. Without it, every page a
     suite boots keeps running and later timing assertions starve. */
  return { dom, win, errors,
    advance: ms => { win.__now += ms; },
    close: () => { try { win.close(); } catch (e) {} } };
}

const saved = win => JSON.parse(win.localStorage.getItem('obliterator:state') || 'null');

module.exports = { boot, saved };
