/* Obliterator <-> Debt Star round trips: no crash, session survives. */
const { boot, saved } = require('./harness');

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : '')));

const DEBT = () => ({ id: 'd1', name: 'Card', code: 'DB-1', balance: 500,
                      original: 1000, apr: 20, monthly: 50, paid: 0, craters: [] });

async function withSession(opts) {
  const b = await boot(opts);
  const A = b.win.__app;
  A.S.debts.push(DEBT());
  A.S.minutes = 25;
  b.win.document.getElementById('target').value = 'write the report';
  A.focusAcquire();
  A.S.objectives = [
    { id: 'o1', text: 'open the doc', done: false, est: 2, actualSec: 0 },
    { id: 'o2', text: 'write the intro', done: false, est: 10, actualSec: 0 }
  ];
  await A.persist();
  return b;
}

(async () => {
  // ------------------------------------------------ the crash on return
  console.log('\nround trip does not crash');
  let b = await withSession();
  let A = b.win.__app;
  let threw = null;
  try { A.setMode('debt'); } catch (e) { threw = e.message; }
  ok('switching to Debt Star does not throw', threw === null, threw);
  ok('#clock survives the switch', !!b.win.document.getElementById('clock'));
  ok('projection readout is filled in', b.win.document.getElementById('clock-eta').textContent !== '—',
     b.win.document.getElementById('clock-eta').textContent);
  ok('focus readout hidden', b.win.document.getElementById('clock-focus').className.includes('hidden'));

  threw = null;
  try { A.setMode('focus'); } catch (e) { threw = e.message; }
  ok('switching back does not throw', threw === null, threw);
  ok('#clock still there', !!b.win.document.getElementById('clock'));
  ok('focus readout shown again', !b.win.document.getElementById('clock-focus').className.includes('hidden'));
  ok('projection hidden again', b.win.document.getElementById('clock-proj').className.includes('hidden'));

  // ------------------------------------------------- the session itself
  console.log('\nsession survives the round trip');
  ok('target name kept', A.S.name === 'write the report', JSON.stringify(A.S.name));
  ok('still charging', A.S.phase === 'CHARGING', A.S.phase);
  ok('both objectives kept', A.S.objectives.length === 2, 'got ' + A.S.objectives.length);
  ok('objective text intact', A.S.objectives[0].text === 'open the doc');
  ok('countdown intact', A.S.left > 1400 && A.S.left <= 1500, 'left=' + A.S.left);
  ok('timer running again', A.S.tick !== null);
  ok('target input still locked', b.win.document.getElementById('target').disabled === true);
  ok('clock shows a time, not a projection',
     /^\d\d:\d\d$/.test(b.win.document.getElementById('clock').textContent),
     b.win.document.getElementById('clock').textContent);

  // -------------------------------------- time keeps passing while away
  console.log('\ntime keeps passing on the other tab');
  const before = A.S.left;
  A.setMode('debt');
  b.win.__now += 300000;                       // five minutes on Debt Star
  A.setMode('focus');
  ok('five minutes elapsed, not frozen', Math.abs(A.S.left - (before - 300)) <= 2,
     'left=' + A.S.left + ' expected≈' + (before - 300));

  // -------------------------------------------- objectives still usable
  console.log('\nthe restored session is still interactive');
  A.toggleObjective('o1');
  ok('objective toggles', A.S.objectives[0].done === true);
  A.toggleObjective('o2');
  ok('completing all triggers the surge', A.S.surged === true);

  // ----------------------------------------------------- hold survives
  console.log('\na held session survives the round trip');
  b = await withSession();
  A = b.win.__app;
  A.toggleHold();
  const heldLeft = A.S.left;
  A.setMode('debt');
  b.win.__now += 600000;                       // ten minutes away, on hold
  A.setMode('focus');
  ok('still on hold', A.S.phase === 'HOLD', A.S.phase);
  ok('charge not eaten while held', A.S.left === heldLeft, 'left=' + A.S.left);
  ok('button offers resume',
     b.win.document.getElementById('hold').textContent.indexOf('Resume') === 0);

  // ------------------------------- countdown expiring on the other tab
  console.log('\ncountdown expiring while on Debt Star');
  b = await withSession();
  A = b.win.__app;
  A.S.objectives.forEach(o => { o.done = true; });
  A.setMode('debt');
  b.win.__now += 1600000;                      // past the deadline
  A.setMode('focus');
  ok('reactor at zero', A.S.left === 0, 'left=' + A.S.left);
  ok('armed on return', A.S.phase === 'READY', A.S.phase);
  ok('fire button live', b.win.document.getElementById('fire').disabled === false);
  ok('no stray interval', A.S.tick === null);

  // ------------------------------------ persistence across the switch
  console.log('\nparked session is persisted too');
  b = await withSession();
  A = b.win.__app;
  A.setMode('debt');
  await A.persist();
  const s = saved(b.win);
  ok('session still in storage while on Debt Star', !!s.session, JSON.stringify(s.session));
  ok('objectives still in storage', s.session && s.session.objectives.length === 2);

  // reload straight into Debt Star, then switch to Obliterator
  const carried = saved(b.win);
  const r = await boot({ storage: carried, now: b.win.Date.now() + 30000 });
  ok('boots into Debt Star cleanly', r.errors.length === 0, r.errors.join(' | '));
  ok('lands on the debt tab', r.win.__app.S.mode === 'debt', r.win.__app.S.mode);
  r.win.__app.setMode('focus');
  ok('session recovered after reload-into-debt', r.win.__app.S.name === 'write the report',
     JSON.stringify(r.win.__app.S.name));
  ok('objectives recovered', r.win.__app.S.objectives.length === 2,
     'got ' + r.win.__app.S.objectives.length);

  // ---------------------------------------- no session = no false hold
  console.log('\nno session means nothing to restore');
  b = await boot();
  A = b.win.__app;
  A.S.debts.push(DEBT());
  A.setMode('debt');
  A.setMode('focus');
  ok('lands idle', A.S.phase === 'IDLE', A.S.phase);
  ok('no phantom target', A.S.name === '', JSON.stringify(A.S.name));
  ok('target input usable', b.win.document.getElementById('target').disabled === false);
  await A.persist();
  ok('storage has no session', saved(b.win).session === null);

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
