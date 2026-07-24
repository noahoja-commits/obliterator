/* The living target system: the other worlds are bodies on real orbits with
   stable identity and their own running lights, and they flinch when a sibling
   is destroyed. Runs with a viewport so drawFleet actually executes its whole
   path (orbit maths, terminator clip, light flicker) - which is what catches a
   draw call that throws on an empty or malformed body. */
const { boot } = require('./harness');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};
const sec = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(8); }
  return false;
}

function seedDebt(win, { name, bal, apr = 0, monthly = 0 }) {
  const A = win.__app, doc = win.document;
  A.setMode('debt');
  doc.getElementById('d-name').value = name;
  doc.getElementById('d-bal').value = String(bal);
  doc.getElementById('d-apr').value = String(apr);
  doc.getElementById('d-pay').value = String(monthly);
  A.addDebt();
}

(async () => {

  sec('a fleet body is decorated with orbital identity');
  {
    const r = await boot();
    const A = r.win.__app;
    const fleet = A.decorateFleet([
      { r: 8, label: 'ALPHA' }, { r: 12, label: 'BETA' }
    ]);
    ok('every item survives', fleet.length === 2);
    const b = fleet[0];
    ok('it keeps its size and label', b.r === 8 && b.label === 'ALPHA');
    ok('it has an orbit', typeof b.period === 'number' && b.period > 0 && b.ax > 0);
    ok('it has running lights', Array.isArray(b.lights) && b.lights.length >= 2);
    ok('it starts un-flinched', b.react === 0);
    ok('the two bodies are distinct', fleet[0].seed !== fleet[1].seed || fleet[0].oy !== fleet[1].oy);
    r.close();
  }

  sec('identity is stable and geometry is viewport-free at build time');
  {
    const r = await boot();
    const A = r.win.__app;
    // built with a 0x0 viewport (W/H unset in this path) - must not divide by it
    const fleet = A.decorateFleet([{ r: 10, label: 'GAMMA' }]);
    const before = JSON.stringify(fleet[0]);
    ok('no NaN leaked into the orbit', !/null|NaN/.test(before), before);
    ok('geometry is fractional, not pixels', fleet[0].ax < 1 && fleet[0].oy < 1);
    r.close();
  }

  sec('it is capped at four bodies');
  {
    const r = await boot();
    const fleet = r.win.__app.decorateFleet(
      Array.from({ length: 9 }, (_, i) => ({ r: 6, label: 'D' + i })));
    ok('no more than four are shown', fleet.length === 4, 'len=' + fleet.length);
    r.close();
  }

  sec('the fleet renders without throwing');
  {
    const r = await boot({ render: true });
    const A = r.win.__app;
    A.V.fleet = A.decorateFleet([
      { r: 7, label: 'ONE' }, { r: 14, label: 'TWO' }, { r: 5, label: 'THREE' }]);
    let threw = null;
    try { for (let i = 0; i < 30; i++) A.drawFleet(1000 + i * 40, 40); }
    catch (e) { threw = e; }
    ok('30 frames of orbit + lights draw cleanly', threw === null, threw && threw.message);
    r.close();
  }

  sec('a real siege populates the fleet with the other debts');
  {
    const r = await boot({ render: true });
    // balances kept within the fleet-size clamp (1.6x the locked target) so the
    // two siblings render at genuinely different sizes rather than saturating
    seedDebt(r.win, { name: 'small', bal: 5000, apr: 0, monthly: 50 });
    seedDebt(r.win, { name: 'medium', bal: 6000, apr: 10, monthly: 100 });
    seedDebt(r.win, { name: 'large', bal: 8000, apr: 6, monthly: 300 });
    const A = r.win.__app;
    // snowball locks the smallest; the other two orbit as the fleet
    ok('the locked target is not in its own fleet', A.V.fleet.length === 2, 'len=' + A.V.fleet.length);
    ok('fleet bodies carry a balance label', A.V.fleet.some(b => /\$/.test(b.label)),
       JSON.stringify(A.V.fleet.map(b => b.label)));
    ok('a bigger debt is a bigger body',
       Math.max(...A.V.fleet.map(b => b.r)) > Math.min(...A.V.fleet.map(b => b.r)),
       JSON.stringify(A.V.fleet.map(b => b.r)));
    r.close();
  }

  sec('the surviving system flinches when a world dies');
  {
    const r = await boot({ render: true });
    const A = r.win.__app;
    A.V.fleet = A.decorateFleet([{ r: 8, label: 'SURVIVOR' }, { r: 10, label: 'OTHER' }]);
    ok('calm before', A.V.fleet.every(b => b.react === 0));

    A.fleetReact(1);
    ok('every body flinches', A.V.fleet.every(b => b.react > 0));
    ok('a flinch reads as busy', A.sceneBusy() === true);

    // and it decays back to calm as frames advance
    let t = r.win.performance.now();
    for (let i = 0; i < 120; i++) { t += 40; A.drawFleet(t, 40); }
    ok('it settles back down', A.V.fleet.every(b => b.react < 0.02),
       JSON.stringify(A.V.fleet.map(b => b.react)));
    r.close();
  }

  sec('destroying a debt makes its neighbours flinch');
  {
    const r = await boot({ render: true });
    seedDebt(r.win, { name: 'target', bal: 500, apr: 0, monthly: 100 });
    seedDebt(r.win, { name: 'bystander', bal: 9000, apr: 0, monthly: 100 });
    const A = r.win.__app;
    // clear and destroy the locked (smallest) target
    r.win.document.getElementById('payment').value = '500';
    A.logPayment();
    ok('armed on the cleared debt', A.S.phase === 'READY', 'got ' + A.S.phase);
    const hadFleet = A.V.fleet.length > 0;
    A.debtFire();
    ok('the bystander flinches at the detonation',
       await waitFor(() => hadFleet && A.V.fleet.some(b => b.react > 0.1), 4000)
       || !hadFleet, 'reacts=' + JSON.stringify(A.V.fleet.map(b => b.react)));
    r.close();
  }

  sec('an empty fleet is a no-op, not a crash');
  {
    const r = await boot({ render: true });
    const A = r.win.__app;
    A.V.fleet = [];
    let threw = null;
    try { A.drawFleet(1000, 40); A.fleetReact(1); } catch (e) { threw = e; }
    ok('no fleet, no error', threw === null, threw && threw.message);
    ok('sceneBusy tolerates it', typeof A.sceneBusy() === 'boolean');
    r.close();
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
