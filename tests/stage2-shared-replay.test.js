// STAGE 2 — the Shared-account replay (plan v11 3C.1a, 3C.5a; owner decisions D-F2, D-F2a = O1, D-F2b, D-F2c).
// Every expected value is hand-calculated in the plan. Each test also runs this file's OWN reference replay
// (its own sort, its own threshold rule, its own held-inflow detection and its own cap), never the engine's,
// and checks the engine against it and against the unchanged cash layer AFTER EVERY ENTRY, not only at the end.
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./load-engine')();

const K = n => Math.round(n * 100);
const N = k => k / 100;
const CONF = '2026-10-01T00:00:00Z';
const BASE = '2026-11-01';
const acct = (id, use, o = {}) => ({ id, label: 'Fictional ' + id, kind: 'bank', opening: 0, use, useConfirmedAt: use ? CONF : null, useConfirmedValue: use || null, ...o });
const ALIASES = { pers_bank: '' }; // a legacy account set to "Not used": money from it is a held unresolved inflow
const shared = (opening, D) => acct('sh', 'shared', { opening, sharedPortion: { amount: D, declaredAt: '2026-10-01' } });
let nid = 1;
const ex = (date, time, amount, o = {}) => ({ id: nid++, type: 'expense', amount, desc: 'Fictional', cat: 'Other', date, time, fromAcct: 'sh', toAcct: '', state: 'Manual', ...o });
const pharm = (date, time, amount, o = {}) => ex(date, time, amount, { purpose: 'pharmacy', desc: 'Fictional pharmacy payment', ...o });
const personal = (date, time, amount, o = {}) => ex(date, time, amount, { purpose: 'personal', desc: 'Fictional personal payment', ...o });
const split = (date, time, amount, ph, o = {}) => ex(date, time, amount, { split: { method: 'amount', pharmacy: ph, personal: amount - ph }, desc: 'Fictional mixed payment', ...o });
const unresolved = (date, time, amount, o = {}) => ex(date, time, amount, { desc: 'Fictional unresolved payment', ...o });
const income = (date, time, amount, o = {}) => ({ id: nid++, type: 'income', amount, desc: 'Fictional top-up', cat: 'Other', date, time, fromAcct: '', toAcct: 'sh', state: 'Manual', ...o });
const heldIn = (date, time, amount, o = {}) => ({ id: nid++, type: 'transfer', amount, desc: 'Fictional held inflow', cat: 'Transfer', date, time, fromAcct: 'pers_bank', toAcct: 'sh', state: 'Manual', ...o });

/* ── The independent reference (no engine function is called here) ── */
function refOrder(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = a.time || '', tb = b.time || '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  const na = typeof a.id === 'number' ? a.id : /^\d+$/.test(String(a.id)) ? Number(a.id) : null;
  const nb = typeof b.id === 'number' ? b.id : /^\d+$/.test(String(b.id)) ? Number(b.id) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1; if (nb !== null) return 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}
const refDelta = t => (t.fromAcct === 'sh' ? -K(t.amount) : 0) + (t.toAcct === 'sh' ? K(t.amount) : 0);
const refHeld = t => (t.toAcct === 'sh' && t.fromAcct === 'pers_bank' && K(t.amount) > 0 ? K(t.amount) : 0);
const refPharmacyPart = t => {
  if (t.fromAcct !== 'sh' || (t.type !== 'expense' && t.type !== 'obligation')) return 0;
  if (t.split) return K(t.split.pharmacy);
  return t.purpose === 'pharmacy' ? K(t.amount) : 0;
};
// The cash layer's threshold rule, written out independently: A = B − min(H, max(B, 0)); D while A ≥ D, else 0.
const refPortion = (B, H, D) => { const A = B - Math.min(H, Math.max(B, 0)); return A >= D ? D : 0; };
function reference(accountOpening, D, txns) {
  const Dk = K(D), pre = txns.filter(t => t.date < BASE), list = txns.filter(t => t.date >= BASE).slice().sort(refOrder);
  let B = K(accountOpening), H = 0;
  const rows = [], per = {};
  let c2 = 0, nc = 0, preOpening = 0, disc = 0;
  for (const t of pre) { const P = refPharmacyPart(t); if (P > 0) { preOpening += P; per[t.id] = { c2: 0, nc: 0, pre: P }; } }
  for (const t of list) {
    const before = refPortion(B, H, Dk); B += refDelta(t); H += refHeld(t);
    const after = refPortion(B, H, Dk), fall = Math.max(0, before - after), P = refPharmacyPart(t), c = P > 0 ? Math.min(P, fall) : 0;
    rows.push({ id: t.id, B, H, A: B - Math.min(H, Math.max(B, 0)), before, after, fall, c2: c });
    disc += fall - c;
    if (P > 0) { c2 += c; nc += P - c; per[t.id] = { c2: c, nc: P - c, pre: 0 }; }
  }
  return { rows, per, c2, nc, preOpening, disc, finalB: B, finalH: H, finalPortion: refPortion(B, H, Dk) };
}

/* ── Engine and cash-layer readings ── */
const OPTS = { aliases: ALIASES, baselineDate: BASE, from: '2026-10-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' };
function engine(accountOpening, D, txns) {
  const A = [shared(accountOpening, D)];
  const m = F.financialMeasures(A, txns, OPTS);
  return { A, m, rep: m.sharedReplay.sh };
}
// After EVERY entry: the cash layer on that prefix (accountBalances, unreconciledInflows, pharmacyEligibleAccounts),
// the reference's running B, H and portion, and the engine's replay row must all agree.
function assertEveryStep(A, txns, ref, rep) {
  const sorted = txns.filter(t => t.date >= BASE).slice().sort(refOrder);
  assert.equal(rep.rows.length, sorted.length, 'one replay row per entry on or after the opening date');
  sorted.forEach((t, i) => {
    const prefix = sorted.slice(0, i + 1).concat(txns.filter(x => x.date < BASE));
    const bal = F.accountBalances(A, prefix, { baselineDate: BASE, aliases: ALIASES });
    const held = F.unreconciledInflows(A, prefix, { baselineDate: BASE, aliases: ALIASES }).byAccount;
    const el = F.pharmacyEligibleAccounts(A.map(a => ({ ...a, balance: bal[a.id] })), { unreconciled: held });
    const r = ref.rows[i], e = rep.rows[i];
    assert.equal(e.id, t.id, `row ${i + 1}: same entry in the same position`);
    assert.equal(K(bal.sh), r.B, `row ${i + 1}: reference balance = cash layer accountBalances`);
    assert.equal(K(held.sh || 0), r.H, `row ${i + 1}: reference held = cash layer unreconciledInflows`);
    assert.equal(K(el.accounts[0].balance), r.after, `row ${i + 1}: reference portion = cash layer pharmacyEligibleAccounts`);
    assert.equal(K(e.balanceAfter), r.B, `row ${i + 1}: engine balance`); assert.equal(K(e.held), r.H, `row ${i + 1}: engine held`);
    assert.equal(K(e.portionBefore), r.before, `row ${i + 1}: engine portion before`); assert.equal(K(e.portionAfter), r.after, `row ${i + 1}: engine portion after`);
    assert.equal(K(e.fall), r.fall, `row ${i + 1}: engine fall`); assert.equal(K(e.c2), r.c2, `row ${i + 1}: engine C2`);
  });
}
// Every entry's contributions conserve its amount: C2 + not counted + pre-opening + personal + unresolved (C4) = amount
// for every Shared payment; a discrepancy reduction is in no spending or burn figure.
function assertNoDoubleCount(m, txns) {
  for (const t of txns.filter(x => x.fromAcct === 'sh' && (x.type === 'expense' || x.type === 'obligation'))) {
    const e = m.entries.find(x => x.id === t.id); const c = e.contrib;
    const parts = K(c.f2Counted || 0) + K(c.f2NotCounted || 0) + K(c.f2PreOpening || 0) + K(c.personalExpenses || 0) + K(c.unresolvedSpending || 0);
    assert.equal(parts, K(t.amount), `entry ${t.id}: every kobo once (C2, not counted, pre-opening, personal, unresolved)`);
    assert.ok(K(c.f2Counted || 0) <= K(e.parts.pharmacy), `entry ${t.id}: 0 ≤ C2 ≤ pharmacy part (cap)`);
    assert.ok(K(c.f2Counted || 0) >= 0);
    assert.equal(K(c.f2 || 0), K(c.f2Counted || 0) + K(c.f2NotCounted || 0) + K(c.f2PreOpening || 0), `entry ${t.id}: F2 = C2 + not counted + pre-opening`);
  }
  // The burn is exactly C1..C8; nothing from a discrepancy reduction is added to any figure.
  const f = m.figures;
  assert.equal(K(f.burn), K(f.f1) + K(f.f2Counted) + K(f.unresolvedSpendingBusiness) + K(f.unresolvedSpendingShared) + K(f.unresolvedFinanceCostBusiness) + K(f.unresolvedFinanceCostShared) + K(f.provisionalBusiness) + K(f.provisionalShared));
  assert.equal(K(m.pharmacyCashBurn), K(f.burn));
  assert.equal(K(f.b1), K(f.f1) + K(f.f2) + K(f.f3) + K(f.f4), 'B1 = F1 + F2 + F3 + F4');
  assert.equal(K(f.b1), K(m.pharmacyOperatingExpenses), 'B1 is the Stage 1 pharmacy operating expenditure, unchanged');
  const spend = K(f.b1) + K(f.personalExpenses) + K(f.unresolvedSpending) + K(f.unresolvedFinanceCost);
  const recorded = txns.filter(x => (x.type === 'expense' || x.type === 'obligation') && x.date >= OPTS.from && x.date <= OPTS.to).reduce((s, x) => s + K(x.amount), 0);
  assert.equal(spend, recorded, 'spending figures sum to the recorded payments: no discrepancy reduction is ever spending');
}

/* ── The worked replay (plan 3C.1a): D = ₦100,000; opening ₦150,000; opening date 1 Nov ── */
function worked(swap = false, sameTime = false) {
  nid = 100;
  const pre = pharm('2026-10-20', '09:00', 8000);
  const e1 = personal('2026-11-01', '09:00', 30000);
  const e2 = pharm('2026-11-03', '10:00', 25000);
  const e3 = income('2026-11-05', '09:00', 40000);
  const e4 = split('2026-11-07', sameTime ? '11:00' : swap ? '15:00' : '11:00', 30000, 12000);
  const e5 = pharm('2026-11-07', sameTime ? '11:00' : swap ? '11:00' : '15:00', 10000);
  const e6 = unresolved('2026-11-09', '09:00', 4000);
  const e7 = pharm('2026-11-10', '09:00', 5000);
  return { list: [pre, e1, e2, e3, e4, e5, e6, e7], ids: { pre: pre.id, e2: e2.id, e4: e4.id, e5: e5.id, e6: e6.id, e7: e7.id } };
}

test('S1 threshold crossing: ₦110,000, pharmacy ₦20,000 → C2 ₦20,000; the other ₦80,000 of the fall is a discrepancy reduction, never spending', () => {
  nid = 1; const txns = [pharm('2026-11-03', '09:00', 20000)];
  const { A, m, rep } = engine(110000, 100000, txns), ref = reference(110000, 100000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  assert.equal(m.figures.f2Counted, 20000); assert.equal(m.figures.f2NotCounted, 0); assert.equal(rep.discrepancyReductions, 80000);
  assert.equal(m.pharmacyCashBurn, 20000, 'only the payment itself enters the burn');
  // Available falls by ₦100,000 through the cash layer only (the account leaves confirmed cash, flagged).
  const before = F.financialMeasures(A, [], OPTS).confirmedPharmacyCash.available;
  assert.equal(before - m.confirmedPharmacyCash.available, 100000);
  assert.ok(m.confirmedPharmacyCash.warnings.some(w => w.key === 'shared_discrepancy'));
});

test('S2 already below: ₦90,000 (flagged), pharmacy ₦5,000 → C2 ₦0, not counted ₦5,000', () => {
  nid = 1; const txns = [pharm('2026-11-03', '09:00', 5000)];
  const { A, m, rep } = engine(90000, 100000, txns), ref = reference(90000, 100000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  assert.deepEqual([m.figures.f2Counted, m.figures.f2NotCounted, m.pharmacyCashBurn], [0, 5000, 0]);
});

test('S3 well above: ₦260,000, pharmacy ₦20,000 → C2 ₦0, not counted ₦20,000', () => {
  nid = 1; const txns = [pharm('2026-11-03', '09:00', 20000)];
  const { A, m, rep } = engine(260000, 100000, txns), ref = reference(260000, 100000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  assert.deepEqual([m.figures.f2Counted, m.figures.f2NotCounted, m.pharmacyCashBurn], [0, 20000, 0]);
});

test('S4 top-up: in the worked replay, C2 ₦25,000 (3 Nov), then ₦10,000 (7 Nov) after the 5 Nov top-up restores the portion', () => {
  const w = worked(); const { A, m, rep } = engine(150000, 100000, w.list), ref = reference(150000, 100000, w.list);
  assertEveryStep(A, w.list, ref, rep);
  const c2 = id => m.entries.find(e => e.id === id).contrib.f2Counted || 0;
  assert.equal(c2(w.ids.e2), 25000); assert.equal(c2(w.ids.e5), 10000);
  const topUp = rep.rows.find(r => r.date === '2026-11-05');
  assert.deepEqual([topUp.portionBefore, topUp.portionAfter], [0, 100000], 'the confirmed top-up restores the portion to D');
});

test('S5 pre-opening: a pharmacy payment dated before the opening date counts ₦0, is shown as pre-opening, and does not move the tracked balance', () => {
  nid = 1; const pre = pharm('2026-10-20', '09:00', 8000), txns = [pre];
  const { A, m, rep } = engine(150000, 100000, txns);
  assert.equal(m.figures.f2PreOpening, 8000); assert.equal(m.figures.f2Counted, 0); assert.equal(m.figures.f2NotCounted, 0);
  assert.equal(rep.rows.length, 0, 'not replayed'); assert.equal(rep.finalBalance, 150000);
  assert.equal(F.accountBalances(A, txns, { baselineDate: BASE, aliases: ALIASES }).sh, 150000, 'balance unaffected (7.1)');
  assertNoDoubleCount(m, txns);
});

test('S6 mixed purpose: entry 4 (no crossing) C2 ₦0, not counted ₦12,000; a crossing variant counts min(₦12,000, fall) = ₦12,000 and never the personal ₦18,000', () => {
  const w = worked(); const { m } = engine(150000, 100000, w.list);
  const e4 = m.entries.find(e => e.id === w.ids.e4).contrib;
  assert.deepEqual([e4.f2Counted || 0, e4.f2NotCounted, e4.personalExpenses], [0, 12000, 18000]);
  nid = 1; const v = [split('2026-11-03', '09:00', 30000, 12000)];
  const r = engine(105000, 100000, v), ref = reference(105000, 100000, v);
  assertEveryStep(r.A, v, ref, r.rep); assertNoDoubleCount(r.m, v);
  assert.equal(r.m.figures.f2Counted, 12000); assert.equal(r.m.figures.personalExpenses, 18000); assert.equal(r.m.pharmacyCashBurn, 12000, 'the personal part is never burn');
  assert.equal(r.rep.rows[0].fall, 100000); assert.equal(r.rep.rows[0].discrepancyReduction, 88000);
});

test('S7 same date, different times: the worked replay gives C2 ₦35,000; with the 7 Nov times swapped, ₦37,000 (not counted ₦15,000)', () => {
  const a = worked(), ea = engine(150000, 100000, a.list), ra = reference(150000, 100000, a.list);
  assertEveryStep(ea.A, a.list, ra, ea.rep);
  assert.deepEqual([ea.m.figures.f2Counted, ea.m.figures.f2NotCounted], [35000, 17000]);
  const b = worked(true), eb = engine(150000, 100000, b.list), rb = reference(150000, 100000, b.list);
  assertEveryStep(eb.A, b.list, rb, eb.rep);
  assert.deepEqual([eb.m.figures.f2Counted, eb.m.figures.f2NotCounted], [37000, 15000]);
  assert.deepEqual([K(ea.m.figures.f2Counted), K(eb.m.figures.f2Counted)], [ra.c2, rb.c2], 'engine = reference');
});

test('S8 same date and time: entries 4 and 5 both at 11:00 are ordered by id → C2 ₦35,000', () => {
  const w = worked(false, true); const { A, m, rep } = engine(150000, 100000, w.list), ref = reference(150000, 100000, w.list);
  assert.ok(w.ids.e4 < w.ids.e5); assertEveryStep(A, w.list, ref, rep);
  assert.equal(m.figures.f2Counted, 35000);
});

test('S9 order independence: the worked replay supplied in 200 seeded random orders and reversed gives identical figures every time', () => {
  const w = worked(), base = engine(150000, 100000, w.list).m;
  const pick = m => JSON.stringify([m.figures.f2Counted, m.figures.f2NotCounted, m.figures.f2PreOpening, m.figures.unresolvedSpendingShared, m.figures.burn, m.pharmacyCashBurn, m.runway.burn]);
  let seed = 20261113; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const orders = [w.list.slice().reverse()];
  for (let i = 0; i < 200; i++) { const a = w.list.slice(); for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; } orders.push(a); }
  for (const o of orders) assert.equal(pick(engine(150000, 100000, o).m), pick(base));
  assert.equal(orders.length, 201);
});

test('S10 unresolved crossing: ₦103,000 and an unresolved Shared payment ₦4,000 → C4 ₦4,000 in full; C2 unchanged; the ₦100,000 fall is a discrepancy reduction, not counted again', () => {
  nid = 1; const txns = [unresolved('2026-11-03', '09:00', 4000)];
  const { A, m, rep } = engine(103000, 100000, txns), ref = reference(103000, 100000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  assert.equal(m.figures.unresolvedSpendingShared, 4000); assert.equal(m.figures.f2Counted, 0); assert.equal(m.pharmacyCashBurn, 4000);
  assert.equal(rep.rows[0].fall, 100000); assert.equal(rep.discrepancyReductions, 100000);
});

test('S11 whole replay: F2 ₦60,000 = C2 ₦35,000 + not counted ₦17,000 + pre-opening ₦8,000; burn from the account ₦39,000; final balance ₦86,000; final portion ₦0', () => {
  const w = worked(); const { A, m, rep } = engine(150000, 100000, w.list), ref = reference(150000, 100000, w.list);
  assertEveryStep(A, w.list, ref, rep); assertNoDoubleCount(m, w.list);
  const f = m.figures;
  assert.deepEqual([f.f2, f.f2Counted, f.f2NotCounted, f.f2PreOpening], [60000, 35000, 17000, 8000]);
  assert.equal(f.unresolvedSpendingShared, 4000); assert.equal(m.pharmacyCashBurn, 39000);
  assert.equal(rep.discrepancyReductions, 165000); assert.equal(K(rep.discrepancyReductions), ref.disc);
  assert.equal(rep.finalBalance, 86000); assert.equal(m.balances.sh, 86000);
  assert.equal(rep.finalPortion, 0); assert.equal(m.confirmedPharmacyCash.available, 0);
  assert.deepEqual([K(f.f2Counted), K(f.f2NotCounted), K(f.f2PreOpening)], [ref.c2, ref.nc, ref.preOpening]);
});

/* ── Held unresolved inflows during the replay (plan 3C.1a, fixtures H1–H3) ── */
test('H1 held inflow between two payments around the threshold: B, H, A and the portion match the cash layer after every row; C2 ₦30,000; a replay ignoring H would give ₦45,000', () => {
  nid = 1;
  const txns = [pharm('2026-11-03', '09:00', 20000), heldIn('2026-11-04', '09:00', 30000), pharm('2026-11-05', '09:00', 25000), income('2026-11-06', '09:00', 40000), pharm('2026-11-07', '09:00', 10000)];
  const { A, m, rep } = engine(110000, 100000, txns), ref = reference(110000, 100000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  const table = [[90000, 0, 90000, 100000, 0, 20000], [120000, 30000, 90000, 0, 0, 0], [95000, 30000, 65000, 0, 0, 0], [135000, 30000, 105000, 0, 100000, 0], [125000, 30000, 95000, 100000, 0, 10000]];
  table.forEach(([B, H, A2, before, after, c2], i) => assert.deepEqual([N(ref.rows[i].B), N(ref.rows[i].H), N(ref.rows[i].A), N(ref.rows[i].before), N(ref.rows[i].after), N(ref.rows[i].c2)], [B, H, A2, before, after, c2], `H1 row ${i + 1}`));
  assert.deepEqual([m.figures.f2Counted, m.figures.f2NotCounted, rep.discrepancyReductions], [30000, 25000, 170000]);
  // The held inflow never restores the portion (row 2 stays 0 → 0).
  assert.deepEqual([rep.rows[1].portionBefore, rep.rows[1].portionAfter, rep.rows[1].fall], [0, 0, 0]);
  // Mutation: a replay that ignores held inflows gives the wrong ₦45,000.
  const naive = reference(110000, 100000, txns.map(t => (t.fromAcct === 'pers_bank' ? { ...t, fromAcct: 'resolved_elsewhere' } : t)));
  assert.equal(naive.c2, K(45000)); assert.notEqual(K(m.figures.f2Counted), naive.c2);
});

test('H2 held inflow masks a crossing: B stays above D but A falls below it, so the ₦10,000 payment counts ₦10,000', () => {
  nid = 1; const txns = [heldIn('2026-11-02', '09:00', 30000), pharm('2026-11-03', '09:00', 10000)];
  const { A, m, rep } = engine(105000, 100000, txns), ref = reference(105000, 100000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  assert.equal(rep.rows[1].balanceAfter, 125000); assert.equal(rep.rows[1].portionAfter, 0, 'portion ₦0 although B ≥ D');
  assert.equal(m.figures.f2Counted, 10000); assert.equal(rep.discrepancyReductions, 90000);
  const naive = reference(105000, 100000, txns.map(t => (t.fromAcct === 'pers_bank' ? { ...t, fromAcct: 'resolved_elsewhere' } : t)));
  assert.equal(naive.c2, 0, 'ignoring H would count ₦0 (wrong)');
});

test('H3 held money spent, then a confirmed top-up: the portion stays ₦0 to the end, matching the cash layer; C2 ₦0; not counted ₦5,000; the personal ₦70,000 is never burn', () => {
  nid = 1; const txns = [heldIn('2026-11-02', '09:00', 40000), personal('2026-11-03', '09:00', 70000), income('2026-11-04', '09:00', 30000), pharm('2026-11-05', '09:00', 5000)];
  const { A, m, rep } = engine(60000, 50000, txns), ref = reference(60000, 50000, txns);
  assertEveryStep(A, txns, ref, rep); assertNoDoubleCount(m, txns);
  assert.deepEqual(rep.rows.map(r => r.portionAfter), [50000, 0, 0, 0]);
  assert.deepEqual([m.figures.f2Counted, m.figures.f2NotCounted, m.pharmacyCashBurn], [0, 5000, 0]);
  assert.equal(m.figures.personalExpenses, 70000);
});

test('H4 held-inflow property: on a generated grid, no held inflow ever has a fall, raises the portion or adds to C2', () => {
  let cases = 0;
  for (const D of [50000, 100000]) for (const opening of [40000, 99999, 100000, 130000]) for (const pos of [0, 1, 2, 3]) for (const h of [5000, 60000]) for (const pay of [3000, 45000]) {
    nid = 1;
    const base = [pharm('2026-11-02', '09:00', pay), income('2026-11-03', '09:00', 20000), pharm('2026-11-04', '09:00', pay)];
    const hi = heldIn('2026-11-0' + (2 + Math.min(pos, 2)), pos === 3 ? '23:00' : '08:00', h);
    const txns = base.concat([hi]);
    const { A, m, rep } = engine(opening, D, txns), ref = reference(opening, D, txns);
    assertEveryStep(A, txns, ref, rep);
    const row = rep.rows.find(r => r.id === hi.id);
    assert.equal(row.fall, 0, 'a held inflow never causes a fall'); assert.ok(row.portionAfter <= row.portionBefore, 'never raises the portion'); assert.equal(row.c2, 0);
    assertNoDoubleCount(m, txns); cases++;
  }
  assert.equal(cases, 128);
});

test('order rule: date, then time with a missing time first, then numeric ids by value before any other id (text order)', () => {
  const xs = [{ id: 'b', date: '2026-11-02', time: '09:00' }, { id: 10, date: '2026-11-02', time: '09:00' }, { id: 9, date: '2026-11-02', time: '09:00' }, { id: 'a', date: '2026-11-02', time: '09:00' },
    { id: 50, date: '2026-11-02', time: '' }, { id: 1, date: '2026-11-03', time: '00:00' }, { id: '7', date: '2026-11-02', time: '09:00' }];
  assert.deepEqual(xs.slice().sort(F.replayOrder).map(x => x.id), [50, '7', 9, 10, 'a', 'b', 1]);
  assert.deepEqual(xs.slice().reverse().sort(F.replayOrder).map(x => x.id), [50, '7', 9, 10, 'a', 'b', 1]);
});
