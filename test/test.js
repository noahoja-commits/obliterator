const { boot, saved } = require('./harness');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};

(async () => {
  // ---------------------------------------------------------------- boot
  console.log('\nboot');
  let { win, errors } = await boot();
  ok('page boots with no script errors', errors.length === 0, errors.join(' | '));
  ok('S.booted is true', win.__app.S && win.__app.S.booted === true);
  ok('deadline starts at 0', win.__app.S.deadline === 0);

  // -------------------------------------------------- timer: suspension
  console.log('\ntimer survives a suspended tab');
  win.__app.S.minutes = 25;
  win.document.getElementById('target').value = 'write the thing';
  win.__app.focusAcquire();
  ok('phase is CHARGING', win.__app.S.phase === 'CHARGING');
  ok('deadline set ~25min out', Math.abs((win.__app.S.deadline - win.Date.now()) - 1500000) < 1500,
     'delta=' + (win.__app.S.deadline - win.Date.now()));
  const startLeft = win.__app.S.left;

  // OS suspends the app for 10 minutes: clock advances, NO ticks fire
  win.advance ? win.advance(600000) : (win.__now += 600000);
  win.__app.tickFocus();
  ok('10 min away = 10 min gone (was ' + startLeft + 's)', win.__app.S.left === startLeft - 600,
     'left=' + win.__app.S.left + ' expected=' + (startLeft - 600));

  // the old code would have lost all 600s here; assert the drift is zero
  ok('no drift after suspension', win.__app.S.left === 900);

  // ------------------------------------------------------ timer: surge
  console.log('\nsurge still shortens the countdown');
  win.__app.S.objectives = [{ id: 'a', text: 'x', done: false, est: 1, actualSec: 0 }];
  const beforeSurge = win.__app.S.left;
  win.__app.toggleObjective('a');
  ok('surged flag set', win.__app.S.surged === true);
  ok('left halved', win.__app.S.left === beforeSurge - Math.floor(beforeSurge / 2),
     'left=' + win.__app.S.left);
  ok('deadline moved with it', Math.abs((win.__app.S.deadline - win.Date.now()) / 1000 - win.__app.S.left) < 2,
     'deadline implies ' + Math.round((win.__app.S.deadline - win.Date.now()) / 1000) + 's, left=' + win.__app.S.left);
  win.__app.tickFocus();
  ok('tick agrees after surge', Math.abs(win.__app.S.left - (beforeSurge - Math.floor(beforeSurge / 2))) <= 1);

  // ------------------------------------------------------- timer: hold
  console.log('\nhold freezes, resume continues');
  const heldAt = win.__app.S.left;
  win.__app.toggleHold();
  ok('phase HOLD', win.__app.S.phase === 'HOLD');
  ok('deadline cleared', win.__app.S.deadline === 0);
  win.__now += 300000;                       // 5 min paused
  ok('left unchanged while held', win.__app.S.left === heldAt, 'left=' + win.__app.S.left);
  win.__app.toggleHold();
  ok('phase CHARGING again', win.__app.S.phase === 'CHARGING');
  win.__app.tickFocus();
  ok('resumes from where it paused', Math.abs(win.__app.S.left - heldAt) <= 1,
     'left=' + win.__app.S.left + ' heldAt=' + heldAt);

  // ------------------------------------------------ persistence: shape
  console.log('\nsession is persisted');
  win.__app.S.objectives = [
    { id: 'o1', text: 'open the file', done: false, est: 2, actualSec: 0 },
    { id: 'o2', text: 'write one line', done: false, est: 5, actualSec: 0 }
  ];
  await win.__app.persist();
  const s = saved(win);
  ok('session block written', !!s.session);
  ok('objectives saved', s.session.objectives.length === 2);
  ok('objective text saved', s.session.objectives[0].text === 'open the file');
  ok('deadline saved', s.session.deadline === win.__app.S.deadline);
  ok('name saved', s.session.name === 'write the thing');

  // ----------------------------------------------- persistence: reload
  console.log('\nreload restores the session');
  const carried = saved(win);
  const nowAtSave = win.Date.now();
  let r = await boot({ storage: carried, now: nowAtSave + 60000 });   // reopened 1 min later
  ok('boots clean from saved session', r.errors.length === 0, r.errors.join(' | '));
  ok('name restored', r.win.__app.S.name === 'write the thing', 'got ' + r.win.__app.S.name);
  ok('phase restored', r.win.__app.S.phase === 'CHARGING', 'got ' + r.win.__app.S.phase);
  ok('both objectives restored', r.win.__app.S.objectives.length === 2,
     'got ' + r.win.__app.S.objectives.length);
  ok('objective text intact', r.win.__app.S.objectives[0].text === 'open the file');
  ok('countdown accounts for the minute away',
     Math.abs(r.win.__app.S.left - (carried.session.left - 60)) <= 2,
     'left=' + r.win.__app.S.left + ' expected≈' + (carried.session.left - 60));
  ok('timer is running again', r.win.__app.S.tick !== null);
  ok('target input locked', r.win.document.getElementById('target').disabled === true);
  ok('session re-saved after restore', !!saved(r.win).session);

  // ------------------------------------- reload after the timer expired
  console.log('\nreload after the countdown already ran out');
  r = await boot({ storage: carried, now: carried.session.deadline + 120000 });
  ok('boots clean', r.errors.length === 0, r.errors.join(' | '));
  ok('left is 0', r.win.__app.S.left === 0, 'got ' + r.win.__app.S.left);
  ok('no runaway interval', r.win.__app.S.tick === null);
  // objectives are still open, so the weapon must NOT arm - time alone isn't enough
  ok('stays unarmed while objectives are open', r.win.__app.S.phase === 'CHARGING',
     'got ' + r.win.__app.S.phase);
  ok('fire button still locked', r.win.document.getElementById('fire').disabled === true);

  // same expired session, but with every objective already done -> should arm
  const doneState = JSON.parse(JSON.stringify(carried));
  doneState.session.objectives.forEach(o => { o.done = true; });
  r = await boot({ storage: doneState, now: carried.session.deadline + 120000 });
  ok('arms when the work is done and time is up', r.win.__app.S.phase === 'READY',
     'got ' + r.win.__app.S.phase);
  ok('fire button live', r.win.document.getElementById('fire').disabled === false);

  // and with no objectives at all, the reactor alone is the whole solution
  const bareState = JSON.parse(JSON.stringify(carried));
  bareState.session.objectives = [];
  r = await boot({ storage: bareState, now: carried.session.deadline + 120000 });
  ok('arms on a bare timer session', r.win.__app.S.phase === 'READY',
     'got ' + r.win.__app.S.phase);

  // ------------------------------------------------ reload while held
  console.log('\nreload while on hold');
  const heldState = JSON.parse(JSON.stringify(carried));
  heldState.session.phase = 'HOLD';
  heldState.session.deadline = 0;
  heldState.session.left = 421;
  r = await boot({ storage: heldState, now: nowAtSave + 86400000 });   // a day later
  ok('still on hold', r.win.__app.S.phase === 'HOLD');
  ok('charge preserved exactly', r.win.__app.S.left === 421, 'got ' + r.win.__app.S.left);
  ok('no interval while held', r.win.__app.S.tick === null);
  ok('button offers resume',
     r.win.document.getElementById('hold').textContent.indexOf('Resume') === 0);

  // ------------------------------------------- backwards compatibility
  console.log('\nold saved state without a session block');
  r = await boot({ storage: { kills: [{ name: 'x', code: 'y', at: 1, detail: '' }], debts: [], mode: 'focus' } });
  ok('boots clean', r.errors.length === 0, r.errors.join(' | '));
  ok('lands idle', r.win.__app.S.phase === 'IDLE');
  ok('kills still restored', r.win.__app.S.kills.length === 1);

  // ------------------------------------------------------ artifact gate
  console.log('\nAI routing skips the dead route when deployed');
  ok('inArtifact() false on the real domain', r.win.__app.inArtifact() === false);

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
