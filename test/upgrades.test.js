/* Covers the five upgrades:
     1. frame budget / raytrace cadence / dt-normalised motion
     2. abort takes two presses
     3. backup restore asks before overwriting
     4. screen wake lock follows the reactor
     5. offline is detected instead of thrown as a network error       */
const { boot } = require('./harness');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};
const sec = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* drive a session up to CHARGING */
function startSession(win, name) {
  win.document.getElementById('target').value = name || 'ship the thing';
  win.__app.focusAcquire();
}

(async () => {

  /* ---------- 1. render budget ---------- */
  sec('render budget');
  {
    const r = await boot({ render: true });
    const A = r.win.__app;
    ok('the draw path actually runs under test now', A.stats().frames > 0,
       'frames=' + A.stats().frames);

    const t0 = A.stats();
    await sleep(1500);
    const t1 = A.stats();
    const secs = 1.5;
    const fps = (t1.frames - t0.frames) / secs;
    const rays = (t1.planetPasses - t0.planetPasses) / secs;

    /* Idle is capped at ~30fps where it used to free-run at 60. The floor is
       deliberately loose: jsdom runs the raytrace in software behind a
       setTimeout rAF shim and manages single digits, so this is a check that
       the loop is alive, not a frame-rate benchmark. */
    ok('idle frame rate is capped', fps <= 40, 'fps=' + fps.toFixed(1));
    ok('but the scene is still animating', fps >= 3, 'fps=' + fps.toFixed(1));

    /* the headline claim: the raytrace used to run every 2nd frame (~30/s).
       On an 80ms cadence it must be far below the frame rate. */
    ok('raytrace runs on its own slower cadence', rays < fps * 0.75,
       'rays=' + rays.toFixed(1) + '/s vs fps=' + fps.toFixed(1));
    ok('raytrace is near the 80ms cadence', rays > 0 && rays <= 20,
       'rays=' + rays.toFixed(1) + '/s');

    ok('idle scene is not "busy"', A.sceneBusy() === false);
    r.close();
  }

  /* ---------- dt normalisation ---------- */
  sec('motion is frame-rate independent');
  {
    const r = await boot({ render: true });
    const A = r.win.__app;
    const t = 100000;
    A.V.aimLock = false; A.V.manual = false;
    /* beam>0 marks the scene busy, which drops the frame budget to zero so
       every call below does work. Gaps stay under the app's 50ms spike clamp. */
    A.V.beam = 1;
    A.frame(t);                              // resync `last` away from the live rAF loop
    const d0 = A.V.drift;
    A.frame(t + 20); A.frame(t + 40);        // two 20ms frames
    const twoSteps = A.V.drift - d0;
    const d1 = A.V.drift;
    A.frame(t + 80);                         // one 40ms frame
    const oneBigStep = A.V.drift - d1;
    ok('drift advances by elapsed time, not by frame count',
       Math.abs(twoSteps - oneBigStep) < 1e-9,
       'two=' + twoSteps.toExponential(3) + ' one=' + oneBigStep.toExponential(3));
    A.V.beam = 0;

    // a frame inside the budget is skipped entirely
    A.frame(t + 200);                        // idle again, resync
    const before = A.stats().frames;
    A.frame(t + 205);            // 5ms later, below the 33ms idle budget
    ok('a frame inside the budget does no work', A.stats().frames === before,
       'frames moved to ' + A.stats().frames);
    A.frame(t + 400);
    ok('a frame past the budget does work', A.stats().frames === before + 1);
    r.close();
  }

  /* ---------- 2. abort guard ---------- */
  sec('dumping the reactor takes two presses');
  {
    const r = await boot();
    const A = r.win.__app, doc = r.win.document;
    startSession(r.win, 'target alpha');
    ok('session is charging', A.S.phase === 'CHARGING', 'got ' + A.S.phase);
    const logsBefore = A.S.log.length;

    A.abort();
    ok('one press does not dump it', A.S.phase === 'CHARGING', 'got ' + A.S.phase);
    ok('nothing logged yet', A.S.log.length === logsBefore);
    ok('the button asks for confirmation', /confirm/i.test(doc.getElementById('abort').textContent),
       doc.getElementById('abort').textContent);
    ok('name survives', A.S.name === 'target alpha');

    A.abort();
    ok('the second press dumps it', A.S.phase === 'IDLE', 'got ' + A.S.phase);
    ok('logged as an abort', A.S.log.length === logsBefore + 1
       && A.S.log[A.S.log.length - 1].outcome === 'aborted');
    ok('the button label is restored', !/confirm/i.test(doc.getElementById('abort').textContent),
       doc.getElementById('abort').textContent);
    r.close();
  }

  sec('the confirmation does not linger');
  {
    const r = await boot();
    const A = r.win.__app, doc = r.win.document;
    startSession(r.win, 'target beta');
    A.abort();                       // armed
    A.abortDisarm();
    ok('disarming restores the label', !/confirm/i.test(doc.getElementById('abort').textContent));
    A.abort();
    ok('the next press only re-arms, it does not dump', A.S.phase === 'CHARGING',
       'got ' + A.S.phase);

    // switching tabs must not leave a live confirmation behind
    A.setMode('debt'); A.setMode('focus');
    ok('a tab round trip disarms it', !/confirm/i.test(doc.getElementById('abort').textContent),
       doc.getElementById('abort').textContent);
    r.close();
  }

  /* ---------- 3. restore guard ---------- */
  sec('restoring a backup asks first');
  {
    const seeded = {
      kills: [{ name: 'old kill', at: 1 }],
      log: [{ outcome: 'destroyed', at: 1, minutes: 25 }],
      debts: [], intel: [], queue: [], deferred: [], allTime: 7
    };
    const incoming = JSON.stringify({
      kills: [{ name: 'new kill', at: 2 }, { name: 'other', at: 3 }],
      log: [{ outcome: 'aborted', at: 2, minutes: 50 }],
      debts: [], intel: [], queue: [], deferred: [], allTime: 99
    });

    const run = async answer => {
      const asked = [];
      const r = await boot({ storage: seeded, env: w => { w.confirm = m => { asked.push(m); return answer; }; } });
      const A = r.win.__app;
      const file = new r.win.File([incoming], 'backup.json', { type: 'application/json' });
      A.importBackup(file);
      await sleep(150);            // FileReader is async
      return { r, A, asked };
    };

    let { r, A, asked } = await run(false);
    ok('it asks before overwriting', asked.length === 1, 'asked ' + asked.length + ' times');
    ok('the prompt says what is on the device', /1 sessions · 1 kills/.test(asked[0] || ''), asked[0]);
    ok('the prompt says what is in the file', /1 sessions · 2 kills/.test(asked[0] || ''), asked[0]);
    ok('declining changes nothing', A.S.kills.length === 1 && A.S.kills[0].name === 'old kill',
       JSON.stringify(A.S.kills));
    ok('declining leaves allTime alone', A.S.allTime === 7, 'got ' + A.S.allTime);
    ok('and it says so', /cancelled/i.test(r.win.document.getElementById('rec-io').textContent),
       r.win.document.getElementById('rec-io').textContent);
    r.close();

    ({ r, A, asked } = await run(true));
    ok('accepting does the restore', A.S.kills.length === 2, JSON.stringify(A.S.kills));
    ok('accepting takes allTime too', A.S.allTime === 99, 'got ' + A.S.allTime);
    r.close();
  }

  sec('an empty record restores without a prompt');
  {
    const asked = [];
    const r = await boot({ env: w => { w.confirm = m => { asked.push(m); return false; }; } });
    const A = r.win.__app;
    const file = new r.win.File([JSON.stringify({ kills: [{ name: 'k', at: 1 }], log: [] })],
      'b.json', { type: 'application/json' });
    A.importBackup(file);
    await sleep(150);
    ok('nothing to lose, so nothing to ask', asked.length === 0, 'asked ' + asked.length);
    ok('restored anyway', A.S.kills.length === 1);
    r.close();
  }

  /* ---------- 4. wake lock ---------- */
  sec('the screen stays awake while charging');
  {
    const calls = { req: 0, rel: 0 };
    const r = await boot({ env: w => {
      Object.defineProperty(w.navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => { calls.req++;
          return { release: async () => { calls.rel++; }, addEventListener: () => {} }; } }
      });
    } });
    const A = r.win.__app;
    ok('no lock while idle', calls.req === 0);
    ok('idle does not want one', A.wantsWake() === false);

    startSession(r.win, 'stay awake');
    await sleep(30);
    ok('charging takes the lock', calls.req === 1, 'req=' + calls.req);
    ok('charging wants one', A.wantsWake() === true);

    A.toggleHold();               // -> HOLD
    await sleep(30);
    ok('holding releases it', calls.rel === 1, 'rel=' + calls.rel);
    ok('holding does not want one', A.wantsWake() === false);

    A.toggleHold();               // -> CHARGING
    await sleep(30);
    ok('resuming takes it again', calls.req === 2, 'req=' + calls.req);

    A.setMode('debt');
    await sleep(30);
    ok('leaving the tab releases it', calls.rel === 2, 'rel=' + calls.rel);
    r.close();
  }

  sec('a browser without wake lock is not a crash');
  {
    const r = await boot();          // jsdom has no navigator.wakeLock at all
    const A = r.win.__app;
    startSession(r.win, 'no wakelock here');
    await sleep(30);
    ok('session still starts', A.S.phase === 'CHARGING', 'got ' + A.S.phase);
    ok('syncWake is harmless', (() => { try { A.syncWake(); return true; } catch (e) { return false; } })());
    r.close();
  }

  /* ---------- 5. offline ---------- */
  sec('offline is a message, not a network error');
  {
    const r = await boot({ env: w => {
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: false });
    } });
    const A = r.win.__app;
    ok('offline is detected', A.offline() === true);

    let thrown = null;
    try { await A.ask('anything'); } catch (e) { thrown = e; }
    ok('ask() refuses before fetching', thrown !== null && thrown.offline === true,
       thrown && thrown.message);

    const msg = A.aiFail(thrown);
    ok('the message names the actual problem', /no connection/i.test(msg), msg);
    ok('it points out the rest still works', /offline/i.test(msg), msg);
    ok('it does not blame a missing API key', !/api key/i.test(msg), msg);
    r.close();
  }

  sec('online still behaves as before');
  {
    const r = await boot();
    const A = r.win.__app;
    ok('online is not flagged offline', A.offline() === false);
    const msg = A.aiFail(new Error('HTTP 500'));
    ok('a real failure still suggests the key route', /api key/i.test(msg), msg);
    r.close();
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
