/* The staged firing sequence: tributaries -> convergence -> lance -> travel ->
   impact -> fracture -> detonation. Runs with a real viewport so the whole
   draw path executes, which is what catches a stage that throws mid-shot. */
const { boot } = require('./harness');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};
const sec = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Stage arrivals are timer-driven, and jsdom's timers wander under load, so
   wait for the stage rather than for a wall-clock instant. */
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(8); }
  return false;
}

/* The eased values (core bloom, beam travel, fracture spread) advance one
   render frame at a time, and jsdom manages single digit fps with the raytrace
   in software - so a 60ms window may contain no frames at all. Drive frames
   explicitly instead of hoping some land. */
function stepper(win) {
  /* Base the timestamps on the live clock at call time. A base captured once
     goes stale as the test runs, and every stepped frame then lands inside the
     budget and is skipped - which looks exactly like a value that never moved. */
  return (n = 4, dt = 32) => {
    let t = win.performance.now();
    for (let i = 0; i < n; i++) { t += dt; win.__app.frame(t); }
  };
}

/* #t-log only keeps the last 9 lines, so a shot's opening entries are gone by
   the time it ends. Watch the element instead of scraping it afterwards. */
function transcript(win) {
  const lines = [];
  const el = win.document.getElementById('t-log');
  [...el.children].forEach(c => lines.push(c.textContent));
  new win.MutationObserver(ms => ms.forEach(m =>
    [...m.addedNodes].forEach(n => lines.push(n.textContent || '')))).observe(el, { childList: true });
  return lines;
}

/* Drive a session to READY without waiting out a real countdown. */
async function armed(win) {
  const A = win.__app;
  A.S.minutes = 0.05;
  win.document.getElementById('target').value = 'death to the backlog';
  A.focusAcquire();
  A.S.deadline = A.S.deadline - A.S.total * 1000;   // expire it immediately
  A.tickFocus();
  return A;
}

(async () => {

  sec('the sequence is staged, not one beat');
  {
    const r = await boot({ render: true });
    const A = await armed(r.win);
    const step = stepper(r.win);
    ok('weapon is armed', A.S.phase === 'READY', 'got ' + A.S.phase);

    const seen = [];
    A.fireSequence(() => seen.push('done'));
    ok('phase is FIRING', A.S.phase === 'FIRING', 'got ' + A.S.phase);
    ok('fire button is locked out', r.win.document.getElementById('fire').disabled === true);
    ok('nothing has been fired yet', A.V.beam === 0 && A.V.trib.every(x => x === 0));

    // --- the eight tributaries run one at a time, not together
    await waitFor(() => A.V.trib[0] > 0);
    ok('the first tributary discharges', A.V.trib[0] > 0, JSON.stringify(A.V.trib));
    ok('the last one has not', A.V.trib[7] === 0, JSON.stringify(A.V.trib));

    await waitFor(() => A.V.trib.every(x => x > 0));
    ok('all eight eventually go', A.V.trib.every(x => x > 0), JSON.stringify(A.V.trib));
    ok('the beam has not left yet', A.V.beam === 0, 'beam=' + A.V.beam);
    ok('the world is untouched', A.V.planetAlive === true && A.V.impact === 0);

    // --- convergence: the core takes what the shafts gave it
    await waitFor(() => A.V.coreT === 1);
    ok('the core goes critical', A.V.coreT === 1);
    const core0 = A.V.core;
    step(4);
    ok('the core blooms rather than snapping on',
       A.V.core > core0 && A.V.core < 1, 'core=' + A.V.core);

    // --- the bolt leaves the dish and has to cross the gap
    await waitFor(() => A.V.beam > 0);
    ok('the beam leaves the dish', A.V.beam > 0, 'beam=' + A.V.beam);
    ok('it starts at the dish, not at the planet', A.V.beamHead > 0 && A.V.beamHead < 1,
       'head=' + A.V.beamHead);
    ok('nothing has hit anything yet', A.V.impact === 0, 'impact=' + A.V.impact);
    const head0 = A.V.beamHead;
    step(1);
    ok('the head travels toward the target', A.V.beamHead > head0,
       head0 + ' -> ' + A.V.beamHead);

    // --- contact: the surface breaks before the world does
    await waitFor(() => A.V.impact > 0);
    ok('impact registers', A.V.impact > 0, 'impact=' + A.V.impact);
    ok('the beam has crossed by then', A.V.beamHead === 1, 'head=' + A.V.beamHead);
    ok('the crust fractures', A.stats().cracks > 0, 'cracks=' + A.stats().cracks);
    ok('the world is still there, briefly', A.V.planetAlive === true);
    const cr0 = A.V.cracks;
    step(3);
    ok('fractures spread rather than appearing',
       A.V.cracks > cr0 && A.V.cracks < 1, 'cracks=' + A.V.cracks);

    // --- detonation
    await waitFor(() => A.V.planetAlive === false, 3000);
    ok('the world is gone', A.V.planetAlive === false);
    ok('the beam goes with it', A.V.beam === 0 && A.V.beamHead === 0);
    ok('the fracture lines are cleared', A.stats().cracks === 0);
    ok('there is a debris field', A.stats().debris > 0, 'debris=' + A.stats().debris);
    ok('and a shockwave', A.stats().rings > 0, 'rings=' + A.stats().rings);
    ok('but it has not handed back yet', seen.length === 0);

    // --- the wreck settles before the console resets
    ok('it finishes', await waitFor(() => seen.length === 1, 3000), 'callbacks=' + seen.length);
    ok('firing flag is cleared', A.V.firing === false);
    r.close();
  }

  sec('the stages arrive in order');
  {
    const r = await boot({ render: true });
    const A = await armed(r.win);
    const order = [];
    const mark = (name, test) => waitFor(test).then(hit => { if (hit) order.push(name); });

    const watching = Promise.all([
      mark('tributary', () => A.V.trib[0] > 0),
      mark('converge', () => A.V.coreT === 1),
      mark('lance', () => A.V.beam > 0),
      mark('impact', () => A.V.impact > 0),
      mark('detonate', () => A.V.planetAlive === false)
    ]);
    A.fireSequence(() => {});
    await watching;
    ok('every stage happened', order.length === 5, order.join(' -> '));
    ok('and in the right order',
       order.join(' ') === 'tributary converge lance impact detonate', order.join(' -> '));
    r.close();
  }

  sec('the log narrates the shot');
  {
    const r = await boot({ render: true });
    const A = await armed(r.win);
    const lines = transcript(r.win);
    A.fireSequence(() => {});
    await waitFor(() => lines.join('\n').includes('TARGET DESTROYED'), 5000);
    const log = lines.join('\n');
    ok('ignition is logged', /PRIMARY IGNITION/i.test(log));
    ok('tributaries are logged', /tributary \d discharged/i.test(log));
    ok('convergence is logged', /CONVERGENCE CORE CRITICAL/i.test(log));
    ok('discharge is logged', /SUPERLASER DISCHARGE/i.test(log));
    ok('impact is logged', /crustal breach/i.test(log));
    ok('destruction is logged', /TARGET DESTROYED/i.test(log));
    ok('and the narration is in order',
       log.indexOf('PRIMARY IGNITION') < log.indexOf('SUPERLASER DISCHARGE')
       && log.indexOf('SUPERLASER DISCHARGE') < log.indexOf('TARGET DESTROYED'), log);
    r.close();
  }

  sec('a shot in flight can be torn down');
  {
    const r = await boot({ render: true });
    const A = await armed(r.win);
    let done = 0;
    A.fireSequence(() => done++);
    await waitFor(() => A.V.coreT === 1);

    A.cancelFire();
    ok('tributaries cleared', A.V.trib.every(x => x === 0));
    ok('core cleared', A.V.core === 0 && A.V.coreT === 0);
    ok('beam head cleared', A.V.beamHead === 0);
    ok('fracture state cleared', A.V.cracks === 0 && A.stats().cracks === 0);
    ok('firing flag cleared', A.V.firing === false);

    await sleep(A.FIRE.DONE + 300);
    ok('the rest of the sequence never runs', done === 0, 'done=' + done);
    ok('the world survives a cancelled shot', A.V.planetAlive === true);
    r.close();
  }

  sec('switching tabs mid-shot does not leave it half-fired');
  {
    const r = await boot({ render: true });
    const A = await armed(r.win);
    A.fireSequence(() => {});
    ok('the beam gets out', await waitFor(() => A.V.beam > 0), 'beam=' + A.V.beam);
    A.setMode('debt');
    ok('the shot is torn down', A.V.beamHead === 0 && A.V.trib.every(x => x === 0));
    ok('no stray fracture state', A.stats().cracks === 0 && A.V.cracksT === 0);
    ok('no stray core state', A.V.coreT === 0);
    r.close();
  }

  sec('the sequence holds the scene at full frame rate');
  {
    const r = await boot({ render: true });
    ok('a resting console is idle', r.win.__app.sceneBusy() === false);
    const A = await armed(r.win);
    A.fireSequence(() => {});
    await waitFor(() => A.V.trib[0] > 0);
    ok('a discharging tributary counts as busy', A.sceneBusy() === true);
    ok('because the shot is live', A.V.firing === true);
    A.cancelFire();
    ok('and not once it is over', A.V.firing === false);
    r.close();
  }

  sec('the shot still runs with no viewport');
  {
    // no render: W is 0, so every draw call is skipped - the state machine
    // must not depend on anything the renderer does
    const r = await boot();
    const A = await armed(r.win);
    let done = 0;
    A.fireSequence(() => done++);
    ok('it completes anyway', await waitFor(() => done === 1, 6000), 'done=' + done);
    ok('and the target is gone', A.V.planetAlive === false);
    r.close();
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
