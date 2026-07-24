/* The new tactile controls: hold-to-fire, safety guard, dial, reorder. */
const { boot } = require('./harness');

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : '')));

const $ = (w, id) => w.document.getElementById(id);
const pointer = (w, el, type, opts = {}) => el.dispatchEvent(
  new w.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...opts }));

// jsdom has no PointerEvent in older versions — fall back to MouseEvent shape
function ensurePointerEvent(w) {
  if (!w.PointerEvent) {
    w.PointerEvent = class extends w.MouseEvent {
      constructor(t, o = {}) { super(t, o); this.pointerId = o.pointerId ?? 1; }
    };
  }
}

async function armed() {
  const b = await boot();
  const A = b.win.__app;
  ensurePointerEvent(b.win);
  A.S.minutes = 25;
  $(b.win, 'target').value = 'ship it';
  A.focusAcquire();
  b.win.__now += 26 * 60000;      // run the clock out
  A.tickFocus();                  // -> checkArm -> armInterlock
  return b;
}

(async () => {
  // ------------------------------------------------------ hold to fire
  console.log('\nhold to fire');
  let b = await armed();
  let A = b.win.__app;
  ok('weapon armed', A.S.phase === 'READY', A.S.phase);

  const cover = $(b.win, 'cover'), fire = $(b.win, 'fire');
  ok('guard is unlocked, not flung open', cover.className.includes('unlocked') &&
     !cover.className.includes('open'), cover.className);
  ok('guard text tells you to flip it', /flip guard/i.test(cover.innerHTML), cover.innerHTML);

  // a stray tap must not fire
  pointer(b.win, fire, 'pointerdown');
  pointer(b.win, fire, 'pointerup');
  ok('a tap does NOT fire', A.S.phase === 'READY', A.S.phase);

  // holding long enough does
  pointer(b.win, fire, 'pointerdown');
  await new Promise(r => setTimeout(r, 1100));
  ok('holding past the threshold fires', A.S.phase !== 'READY', A.S.phase);
  b.close();

  // releasing early cancels cleanly
  b = await armed(); A = b.win.__app;
  pointer(b.win, $(b.win, 'fire'), 'pointerdown');
  await new Promise(r => setTimeout(r, 250));
  pointer(b.win, $(b.win, 'fire'), 'pointerup');
  await new Promise(r => setTimeout(r, 900));
  ok('released early = no shot', A.S.phase === 'READY', A.S.phase);
  ok('progress bar reset', parseFloat($(b.win, 'fire').style.getPropertyValue('--holdp') || '0') === 0,
     $(b.win, 'fire').style.getPropertyValue('--holdp'));

  // ------------------------------------------------------ safety guard
  console.log('\nsafety guard');
  b = await armed(); A = b.win.__app;
  const cov = $(b.win, 'cover');
  pointer(b.win, cov, 'pointerdown', { clientY: 300 });
  pointer(b.win, cov, 'pointerup', { clientY: 300 });          // tap, no movement
  ok('a tap flips the guard open', cov.className.includes('open'), cov.className);
  ok('guard no longer marked unlocked', !cov.className.includes('unlocked'));

  b = await armed();
  const cov2 = $(b.win, 'cover');
  pointer(b.win, cov2, 'pointerdown', { clientY: 300 });
  pointer(b.win, cov2, 'pointermove', { clientY: 290 });        // only 10px
  pointer(b.win, cov2, 'pointerup', { clientY: 290 });
  ok('a short drag snaps back', !cov2.className.includes('open'), cov2.className);
  pointer(b.win, cov2, 'pointerdown', { clientY: 300 });
  pointer(b.win, cov2, 'pointermove', { clientY: 240 });        // 60px up
  pointer(b.win, cov2, 'pointerup', { clientY: 240 });
  ok('a real drag opens it', cov2.className.includes('open'), cov2.className);

  // guard is resealed for the next target
  b = await boot(); A = b.win.__app; ensurePointerEvent(b.win);
  A.resetWeapon();
  ok('guard resealed after reset', /sealed until charge/i.test($(b.win, 'cover').innerHTML));

  // -------------------------------------------------------------- dial
  console.log('\nsession dial');
  b = await boot(); A = b.win.__app; ensurePointerEvent(b.win);
  const dial = $(b.win, 'dial');
  ok('dial starts at the saved length', $(b.win, 'dial-val').textContent === '25',
     $(b.win, 'dial-val').textContent);
  ok('exposes a slider role', dial.getAttribute('role') === 'slider');

  dial.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  ok('arrow up adds 5 minutes', A.S.minutes === 30, String(A.S.minutes));
  dial.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
  ok('shift+arrow adds 15', A.S.minutes === 45, String(A.S.minutes));
  ok('readout follows', $(b.win, 'dial-val').textContent === '45', $(b.win, 'dial-val').textContent);
  ok('aria-valuenow follows', dial.getAttribute('aria-valuenow') === '45');

  for (let i = 0; i < 40; i++) dial.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  ok('clamps at the floor, never 0', A.S.minutes === 5, String(A.S.minutes));
  for (let i = 0; i < 60; i++) dial.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  ok('clamps at the ceiling', A.S.minutes === 120, String(A.S.minutes));

  // presets and dial stay in sync
  const preset50 = b.win.document.querySelector('#durations button[data-min="50"]');
  preset50.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
  ok('preset updates the dial readout', $(b.win, 'dial-val').textContent === '50',
     $(b.win, 'dial-val').textContent);

  // dial locks while a session runs
  $(b.win, 'target').value = 'x'; A.focusAcquire();
  ok('dial locked during a session', dial.className.includes('off'), dial.className);
  A.resetWeapon();
  ok('dial unlocked again after', !dial.className.includes('off'), dial.className);

  // --------------------------------------------------------- reordering
  console.log('\ndrag to re-sequence');
  b = await boot(); A = b.win.__app; ensurePointerEvent(b.win);
  $(b.win, 'target').value = 'x'; A.focusAcquire();
  A.S.objectives = [
    { id: 'a', text: 'first', done: false, est: 1, actualSec: 0 },
    { id: 'c', text: 'third', done: false, est: 1, actualSec: 0 }
  ];
  A.persist();
  b.win.__app.S.objectives.splice(1, 0, { id: 'b', text: 'second', done: false, est: 1, actualSec: 0 });
  // re-render through the app's own path
  b.win.document.getElementById('s-new').value = '';
  A.toggleObjective('a'); A.toggleObjective('a');   // forces renderStrike twice, ends unchanged
  const grips = b.win.document.querySelectorAll('.sk-grip');
  ok('every objective has a grip', grips.length === 3, 'got ' + grips.length);

  const list = $(b.win, 'strike-list');
  const rows = b.win.document.querySelectorAll('.sk[data-tog]');
  Object.defineProperty(rows[0], 'offsetHeight', { value: 40, configurable: true });
  pointer(b.win, grips[0], 'pointerdown', { clientY: 100 });
  pointer(b.win, list, 'pointermove', { clientY: 182 });   // ~2 rows down
  pointer(b.win, list, 'pointerup', { clientY: 182 });
  ok('order changed', A.S.objectives.map(o => o.id).join('') !== 'abc',
     A.S.objectives.map(o => o.id).join(''));
  ok('nothing lost in the move', A.S.objectives.length === 3,
     'got ' + A.S.objectives.length);

  // clicking the grip must not tick the objective off
  b = await boot(); A = b.win.__app; ensurePointerEvent(b.win);
  $(b.win, 'target').value = 'x'; A.focusAcquire();
  A.S.objectives = [{ id: 'z', text: 'only', done: false, est: 1, actualSec: 0 }];
  A.toggleObjective('z'); A.toggleObjective('z');
  const grip = b.win.document.querySelector('.sk-grip');
  grip.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
  ok('clicking the grip does not tick it off', A.S.objectives[0].done === false);

  // ------------------------------------------------------- instruments
  console.log('\nlive instruments');
  b = await boot();
  const first = $(b.win, 't-cont').textContent;
  ok('containment readout exists', !!first, first);
  ok('shields readout is JS-driven now', !!$(b.win, 't-shield'));
  ok('complement readout is JS-driven now', !!$(b.win, 't-crew'));
  await new Promise(r => setTimeout(r, 1400));   // let the 420ms interval run
  ok('readings actually move', $(b.win, 't-cont').textContent !== first ||
     $(b.win, 't-temp').textContent !== '294 K',
     'cont=' + $(b.win, 't-cont').textContent + ' temp=' + $(b.win, 't-temp').textContent);

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
