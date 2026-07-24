/* Debt Star mode's detail: a payment is a staged, proportional turbolaser
   siege, not one generic beam. Bigger payments throw heavier volleys, carve
   more scars, and cross milestones. The finishing blow arms the interlock, and
   the kill itself reuses the full firing sequence. Runs with a viewport so the
   salvo actually flies. */
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
function stepper(win) {
  return (n = 6, dt = 40) => {
    let t = win.performance.now();
    for (let i = 0; i < n; i++) { t += dt; win.__app.frame(t); }
  };
}
function transcript(win) {
  const lines = [];
  const el = win.document.getElementById('t-log');
  [...el.children].forEach(c => lines.push(c.textContent));
  new win.MutationObserver(ms => ms.forEach(m =>
    [...m.addedNodes].forEach(n => lines.push(n.textContent || '')))).observe(el, { childList: true });
  return lines;
}

/* Seed one debt through the real add path and lock onto it. */
function seedDebt(win, { name, bal, apr = 0, monthly = 0 }) {
  const A = win.__app, doc = win.document;
  A.setMode('debt');
  doc.getElementById('d-name').value = name;
  doc.getElementById('d-bal').value = String(bal);
  doc.getElementById('d-apr').value = String(apr);
  doc.getElementById('d-pay').value = String(monthly);
  A.addDebt();                 // pushes the body and locks onto it
  return A;
}
function pay(win, amt) {
  win.document.getElementById('payment').value = String(amt);
  win.__app.logPayment();
}

(async () => {

  sec('locking a debt aims the station at it');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'visa', bal: 4000, apr: 22, monthly: 200 });
    ok('a target is locked', A.S.lockedId != null);
    ok('phase is charging', A.S.phase === 'CHARGING', 'got ' + A.S.phase);
    ok('the world is present', A.V.planetAlive === true);
    ok('the mass readout shows the balance',
       r.win.document.getElementById('t-mass').textContent.includes('4,000'),
       r.win.document.getElementById('t-mass').textContent);
    ok('an ETA is projected', /MO|NEVER/.test(r.win.document.getElementById('clock-eta').textContent),
       r.win.document.getElementById('clock-eta').textContent);
    r.close();
  }

  sec('a payment is a staged siege, not one beam');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'car loan', bal: 10000, apr: 6, monthly: 300 });
    ok('nothing is in flight before paying', A.V.siege === false && A.stats().salvo === 0);

    pay(r.win, 1500);
    ok('the strike is now in progress', A.V.siege === true);
    ok('the balance dropped', A.S.debts[0].balance === 8500, 'bal=' + A.S.debts[0].balance);

    // the volley launches after the ranging beat
    ok('a volley flies', await waitFor(() => A.stats().salvo > 0 || A.stats().salvoSpawned > 0),
       'salvo=' + A.stats().salvo);
    ok('it is a barrage, not a single bolt', A.stats().salvoSpawned >= 3,
       'spawned=' + A.stats().salvoSpawned);

    // it lands and settles
    ok('the siege completes', await waitFor(() => A.V.siege === false, 4000));
    ok('all bolts have landed', A.stats().salvo === 0);
    ok('the world survives a partial payment', A.V.planetAlive === true);
    ok('the hull eases toward its smaller size', A.V.planetTo < 1, 'planetTo=' + A.V.planetTo);
    r.close();
  }

  sec('the volley scales with the size of the payment');
  {
    // a payment clearing most of the balance should throw far more than a token one
    const small = await boot({ render: true });
    let A = seedDebt(small.win, { name: 'a', bal: 10000, apr: 0, monthly: 100 });
    pay(small.win, 100);                      // 1% of the balance
    await waitFor(() => A.stats().salvoSpawned > 0);
    const smallVolley = A.stats().salvoSpawned;
    small.close();

    const big = await boot({ render: true });
    A = seedDebt(big.win, { name: 'a', bal: 10000, apr: 0, monthly: 100 });
    pay(big.win, 8000);                       // 80% of the balance
    await waitFor(() => A.stats().salvoSpawned > 0);
    const bigVolley = A.stats().salvoSpawned;
    big.close();

    ok('a bigger payment throws a heavier volley', bigVolley > smallVolley,
       'small=' + smallVolley + ' big=' + bigVolley);
  }

  sec('bigger payments carve more scars');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'mortgage', bal: 10000, apr: 4, monthly: 500 });
    const before = A.S.debts[0].craters ? A.S.debts[0].craters.length : 0;
    pay(r.win, 200);                          // small
    const afterSmall = A.S.debts[0].craters.length;
    pay(r.win, 6000);                         // large
    const afterBig = A.S.debts[0].craters.length;
    ok('a small payment leaves a scar or two', afterSmall - before >= 1 && afterSmall - before <= 2,
       'added=' + (afterSmall - before));
    ok('a large payment leaves several', afterBig - afterSmall >= 3,
       'added=' + (afterBig - afterSmall));
    r.close();
  }

  sec('a big payment is called out as critical');
  {
    const r = await boot({ render: true });
    const lines = transcript(r.win);
    const A = seedDebt(r.win, { name: 'loan', bal: 1000, apr: 10, monthly: 100 });
    pay(r.win, 500);                          // half the balance in one hit
    await sleep(80);
    const log = lines.join('\n');
    ok('the log marks it critical', /CRITICAL/.test(log), log);
    r.close();
  }

  sec('a small payment is not critical');
  {
    const r = await boot({ render: true });
    const lines = transcript(r.win);
    const A = seedDebt(r.win, { name: 'loan', bal: 10000, apr: 10, monthly: 100 });
    pay(r.win, 200);                          // 2%
    await sleep(80);
    const log = lines.join('\n');
    ok('no critical marker', !/CRITICAL/.test(log));
    ok('but it is still a hull breach', /hull breach/.test(log), log);
    r.close();
  }

  sec('crossing a milestone is announced');
  {
    const r = await boot({ render: true });
    const lines = transcript(r.win);
    const A = seedDebt(r.win, { name: 'debt', bal: 1000, apr: 0, monthly: 100 });
    pay(r.win, 300);                          // 0% -> 30% destroyed, crosses 25%
    ok('the 25% milestone is logged',
       await waitFor(() => lines.join('\n').includes('25% hull gone'), 2000),
       lines.join('\n'));
    r.close();
  }

  sec('the finishing blow arms the interlock instead of a volley');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'store card', bal: 800, apr: 25, monthly: 50 });
    pay(r.win, 800);                          // clears it exactly
    ok('balance is zero', A.S.debts[0].balance <= 0.005, 'bal=' + A.S.debts[0].balance);
    ok('the interlock releases', A.S.phase === 'READY', 'got ' + A.S.phase);
    ok('the fire control is live', r.win.document.getElementById('fire').disabled === false);
    ok('no volley on the finishing blow', A.stats().salvoSpawned === 0, 'spawned=' + A.stats().salvoSpawned);
    ok('the world is still there to be destroyed', A.V.planetAlive === true);
    r.close();
  }

  sec('destroying a cleared debt runs the full firing sequence');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'paid off', bal: 500, apr: 0, monthly: 100 });
    pay(r.win, 500);
    ok('armed', A.S.phase === 'READY');
    const kills = A.S.kills.length;

    A.debtFire();
    // the same staged sequence the Obliterator uses
    ok('tributaries fire', await waitFor(() => A.V.trib.some(x => x > 0)), JSON.stringify(A.V.trib));
    ok('the world is destroyed', await waitFor(() => A.V.planetAlive === false, 4000));
    ok('the debt is logged as a kill', await waitFor(() => A.S.kills.length === kills + 1, 3000));
    ok('the kill records the amount cleared',
       /500/.test((A.S.kills[A.S.kills.length - 1] || {}).detail || ''),
       JSON.stringify(A.S.kills[A.S.kills.length - 1]));
    r.close();
  }

  sec('a siege in flight can be torn down');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'x', bal: 10000, apr: 0, monthly: 100 });
    pay(r.win, 3000);
    await waitFor(() => A.stats().salvo > 0 || A.V.siege);
    ok('mid-siege', A.V.siege === true);

    A.cancelSiege();
    ok('the volley is cleared', A.stats().salvo === 0);
    ok('the siege flag is down', A.V.siege === false);
    r.close();
  }

  sec('switching tabs mid-siege leaves nothing running');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'x', bal: 10000, apr: 0, monthly: 100 });
    pay(r.win, 3000);
    await waitFor(() => A.V.siege);
    A.setMode('focus');
    ok('the siege is torn down', A.V.siege === false && A.stats().salvo === 0);
    r.close();
  }

  sec('the siege keeps the scene busy while it runs');
  {
    const r = await boot({ render: true });
    const A = seedDebt(r.win, { name: 'x', bal: 10000, apr: 0, monthly: 100 });
    await sleep(1400);                        // let the lock-on settle
    pay(r.win, 3000);
    ok('a live siege counts as busy', A.sceneBusy() === true);
    A.cancelSiege();
    r.close();
  }

  sec('the strike still resolves with no viewport');
  {
    const r = await boot();                   // no render: W is 0, draws are skipped
    const A = seedDebt(r.win, { name: 'x', bal: 10000, apr: 0, monthly: 100 });
    pay(r.win, 3000);
    ok('the balance still drops', A.S.debts[0].balance === 7000, 'bal=' + A.S.debts[0].balance);
    ok('the siege state clears itself', await waitFor(() => A.V.siege === false, 4000));
    r.close();
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
