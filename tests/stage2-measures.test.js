// STAGE 2 — the central measurement layer and its derivations (plan v11 sections 2.1, 3, 3A, 3B, 3C, 3E;
// owner decisions S-1..S-7, P-D18, D-F2, D-F2a = O1, D-F2b, D-F2c, D-F4, D-OC; CF5 correction approved 13 Nov 2026).
// Expected values are hand-calculated in the plan. Where the plan asks for an independent reference, this file
// computes it itself from the design rules (paying side, purpose or split), never from scopeTotals or scopeBurnK.
// Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./load-engine')();

const K = n => Math.round(n * 100);
const CONF = '2026-09-01T00:00:00Z';
const acct = (id, use, o = {}) => ({ id, label: 'Fictional ' + id, kind: 'bank', opening: 0, use, useConfirmedAt: use ? CONF : null, useConfirmedValue: use || null, ...o });
const ALIASES = { pers_bank: '' };
let nid = 1;
const e = o => ({ id: nid++, type: 'expense', amount: 1000, desc: 'Fictional', cat: 'Other', date: '2026-11-10', time: '09:00', fromAcct: '', toAcct: '', state: 'Manual', ...o });
const inc = o => e({ type: 'income', ...o });

/* ── The plan 3B fixture: today 13 Nov 2026, baseline 30 Sep 2026 (45 days) ── */
const OPTS3B = { aliases: ALIASES, baselineDate: '2026-09-30', from: '2026-09-30', to: '2026-11-13', today: '2026-11-13', historyStart: '2026-09-30',
  buckets: [{ id: 'bk1', label: 'Fictional earmark', parentId: 'opay', amount: 100000 }] };
const ACCTS3B = () => [
  acct('opay', 'business', { kind: 'wallet', opening: 846000 }), acct('tb', 'business', { opening: 100000 }),
  acct('pb', 'personal', { opening: 500000 }), acct('sh', 'shared', { opening: 119000, sharedPortion: { amount: 100000, declaredAt: '2026-09-01' } }),
  acct('un', 'business', { opening: 50000, useConfirmedAt: null, useConfirmedValue: null }), // Business, never confirmed: F4
];
function fixture3B(withShared) {
  nid = 1;
  const x = [
    e({ amount: 200000, fromAcct: 'opay', desc: 'F1 stock', cat: 'Restocking', date: '2026-10-05' }),       // no purpose: confirmed Business → pharmacy (rule 4)
    e({ amount: 47500, fromAcct: 'opay', desc: 'F1 rent', cat: 'Rent', date: '2026-10-20' }),
    e({ amount: 15000, fromAcct: 'pb', purpose: 'pharmacy', desc: 'F3 paid personally', cat: 'Restocking', date: '2026-10-21' }),
    e({ amount: 7500, fromAcct: 'un', purpose: 'pharmacy', desc: 'F4 unconfirmed account', cat: 'Utilities', date: '2026-10-22' }),
    e({ amount: 45000, fromAcct: 'opay', purpose: 'unclassified', desc: 'C3 purpose unknown', date: '2026-10-23' }),
    e({ amount: 9000, fromAcct: 'sh', desc: 'C4 Shared, no purpose', date: '2026-10-24' }),               // Shared without purpose: unresolved
    e({ type: 'loan_repayment', amount: 44500, fromAcct: 'opay', alloc: { principal: 40000, interest: 4500, fees: 0 }, desc: 'C5 + principal', date: '2026-10-25' }),
    e({ type: 'loan_repayment', amount: 9000, fromAcct: 'opay', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 9000 }, allocMode: 'provisional', desc: 'C7 provisional', date: '2026-10-26' }),
    e({ amount: 60000, fromAcct: 'pb', desc: 'Personal spending', cat: 'Food', date: '2026-10-27' }),
    e({ amount: 12000, fromAcct: '', desc: 'Unresolved other (no account)', date: '2026-10-28' }),
    e({ type: 'owner_withdrawal', amount: 100000, fromAcct: 'opay', toAcct: 'pb', desc: 'Withdrawal', date: '2026-10-29' }),
  ];
  if (withShared) x.push(e({ amount: 20000, fromAcct: 'sh', purpose: 'pharmacy', desc: 'F2 Shared pharmacy payment', cat: 'Utilities', date: '2026-11-01' }));
  return x;
}
function incomes3E() {
  return [
    inc({ amount: 430000, toAcct: 'opay', desc: '(i) Sales into confirmed Business', date: '2026-11-02' }),
    inc({ amount: 20000, toAcct: 'opay', fromAcct: 'pers_bank', desc: '(ii) held: from an unresolved account', date: '2026-11-03' }),
    inc({ amount: 30000, toAcct: 'pb', split: { method: 'amount', pharmacy: 30000, personal: 0 }, desc: '(iii) into a Personal account', date: '2026-11-04' }),
    inc({ amount: 20000, toAcct: '', purpose: 'pharmacy', desc: '(iv) no receiving account', date: '2026-11-05' }),
  ];
}

test('3B worked example: B1 ₦270,000 (F1 247,500 / F2 0 / F3 15,000 / F4 7,500); burn ₦315,000 over 45 days; ₦7,000 a day; available ₦600,000; 86 days; 21.4% unresolved or provisional', () => {
  const A = ACCTS3B(), m = F.financialMeasures(A, fixture3B(false), OPTS3B), f = m.figures, rf = m.runway.figures;
  assert.deepEqual([f.b1, f.f1, f.f2, f.f3, f.f4], [270000, 247500, 0, 15000, 7500]);
  assert.equal(m.pharmacyOperatingExpenses, 270000);
  const br = F.burnReport(m, { window: true });
  assert.deepEqual(br.components, { c1: 247500, c2: 0, c3: 45000, c4: 9000, c5: 4500, c6: 0, c7: 9000, c8: 0 });
  assert.equal(m.runway.historyDays, 45); assert.equal(m.runway.windowStart, '2026-09-30');
  assert.equal(m.runway.burn, 315000); assert.equal(rf.burn, 315000);
  assert.equal(m.runway.dailyBurn, 7000);
  assert.equal(m.confirmedPharmacyCash.available, 600000); assert.equal(m.confirmedPharmacyCash.earmarked, 100000);
  assert.equal(m.runway.days, 86); assert.equal(m.runway.days, Math.round(600000 / (315000 / 45)));
  assert.notEqual(m.runway.days, Math.round(600000 / 315000), 'never available ÷ burn (wrong formula: 1.90)');
  assert.equal(br.unresolvedShare, 21.4); assert.equal(rf.burnUnresolvedOrProvisional, 67500);
  // Not in the burn: F3, F4, personal spending, unresolved other, principal and withdrawals.
  assert.deepEqual([br.notInBurn.f3, br.notInBurn.f4, br.notInBurn.personal, br.notInBurn.unresolvedOther, br.notInBurn.principal, br.notInBurn.ownerWithdrawals], [15000, 7500, 60000, 12000, 40000, 100000]);
  // Reconciliation: burn = B1 − F3 − F4 + C3..C8.
  assert.equal(K(rf.burn), K(f.b1) - K(f.f3) - K(f.f4) - K(f.f2NotCounted) - K(f.f2PreOpening) + K(rf.burnUnresolvedOrProvisional));
  // Commitments (S-4): due ₦150,000, reserved ₦50,000 → cash after known commitments ₦400,000, shown beside the runway.
  const cover = F.cashCover(m.confirmedPharmacyCash, 150000, 50000);
  assert.equal(cover.freeToUse, 500000); assert.equal(cover.leftAfter, 400000);
  assert.equal(m.runway.days, 86, 'commitments are never deducted from the runway');
});

test('3B Shared variant: a ₦20,000 pharmacy payment from Shared at ₦110,000 (D ₦100,000) → B1 ₦290,000, C2 ₦20,000, burn ₦335,000, available ₦500,000, 67 days', () => {
  const m = F.financialMeasures(ACCTS3B(), fixture3B(true), OPTS3B), f = m.figures;
  assert.equal(f.b1, 290000); assert.equal(f.f2Counted, 20000); assert.equal(f.f2NotCounted, 0);
  assert.equal(m.runway.burn, 335000); assert.equal(Math.round(m.runway.dailyBurn * 100) / 100, 7444.44);
  assert.equal(m.confirmedPharmacyCash.available, 500000); assert.equal(m.runway.days, 67);
  assert.equal(m.sharedReplay.sh.discrepancyReductions, 80000, 'the ₦80,000 beyond the payment lowers available cash, never the burn');
});

test('runway limitations: under 30 days of history → no number (short history); no burn → no number (no spending); history over 90 days → the last 90 days', () => {
  const A = ACCTS3B();
  const short = F.financialMeasures(A, fixture3B(false), { ...OPTS3B, historyStart: '2026-10-25' });
  assert.equal(short.runway.known, false); assert.equal(short.runway.reason, 'short_history'); assert.equal(short.runway.historyDays, 20); assert.equal(short.runway.days, null);
  const none = F.financialMeasures(A, [e({ amount: 6000, fromAcct: 'pb', purpose: 'pharmacy', date: '2026-11-01' })], OPTS3B);
  assert.equal(none.runway.reason, 'no_spending', 'F3 alone is not cash burn'); assert.equal(none.runway.days, null);
  const long = F.financialMeasures(A, fixture3B(false), { ...OPTS3B, historyStart: '2026-04-27' });
  assert.equal(long.runway.historyDays, 90); assert.equal(long.runway.windowStart, '2026-08-16');
});

/* ── 3E: the two Cash Flow operating measures ── */
test('CF1 the 3E.3 example: OP-R ₦230,000, OP-C ₦182,500, difference ₦47,500, burn check ₦315,000; Shared variant ₦210,000 / ₦162,500 / ₦47,500 / ₦335,000', () => {
  for (const [shared, opR, opC, burn] of [[false, 230000, 182500, 315000], [true, 210000, 162500, 335000]]) {
    const m = F.financialMeasures(ACCTS3B(), fixture3B(shared).concat(incomes3E()), OPTS3B), cf = F.cashFlowStatement(m), f = m.figures;
    assert.deepEqual([f.pharmacyReceipts, f.incomeCashReceived, f.incomeNotConfirmedCash, f.incomeOtherAccount, f.incomeNoAccount], [500000, 430000, 20000, 30000, 20000]);
    assert.equal(cf.operatingResult, opR); assert.equal(cf.operatingCash, opC);
    assert.equal(cf.difference.total, 47500); assert.equal(cf.difference.incomeNotConfirmedCash, 70000); assert.equal(cf.difference.spendingNotFromConfirmedCash, 22500);
    assert.equal(K(cf.operatingCashParts.paidFromConfirmedCash) + K(cf.separate.unresolvedOrProvisionalBusiness) + K(cf.separate.unresolvedOrProvisionalShared), K(burn), 'OP-C outflow + separate lines = the burn');
    assert.equal(m.pharmacyCashBurn, burn);
  }
});

function identities(m, label) {
  const f = m.figures, cf = F.cashFlowStatement(m), k = x => K(f[x]);
  // 3C.3 identities 1–3, 5 (6 is checked against the explanation and runway elsewhere).
  assert.equal(k('b1'), k('f1') + k('f2') + k('f3') + k('f4'), label + ': B1 = F1 + F2 + F3 + F4');
  assert.equal(k('f2'), k('f2Counted') + k('f2NotCounted') + k('f2PreOpening'), label + ': F2 = C2 + not counted + pre-opening');
  assert.equal(k('burn'), k('b1') - k('f3') - k('f4') - k('f2NotCounted') - k('f2PreOpening') + k('burnUnresolvedOrProvisional'), label + ': burn = B1 − F3 − F4 − F2 not counted + C3..C8');
  assert.equal(k('burn'), K(m.pharmacyCashBurn));
  assert.equal(k('b1'), K(m.pharmacyOperatingExpenses), label + ': B1 is the Stage 1 measure');
  // 3A: the four income lines partition recorded pharmacy income exactly.
  assert.equal(k('incomeCashReceived') + k('incomeNotConfirmedCash') + k('incomeOtherAccount') + k('incomeNoAccount'), k('pharmacyReceipts'), label + ': (i)+(ii)+(iii)+(iv)');
  assert.equal(k('incomeNoAccount'), K(m.pharmacyReceiptsNoReceivingAccount), label + ': (iv) = the Stage 1 no-receiving-account figure');
  // 3E.2 identities 1–4.
  assert.equal(K(cf.operatingResult), k('pharmacyReceipts') - k('b1'), label + ': OP-R');
  assert.equal(K(cf.operatingCash), k('incomeCashReceived') - k('f1') - k('f2Counted'), label + ': OP-C');
  assert.equal(K(cf.operatingResult) - K(cf.operatingCash), (k('incomeNotConfirmedCash') + k('incomeOtherAccount') + k('incomeNoAccount')) - (k('f3') + k('f4') + k('f2NotCounted') + k('f2PreOpening')), label + ': OP-R − OP-C = reconciling line');
  assert.equal(K(cf.difference.total), K(cf.operatingResult) - K(cf.operatingCash));
  assert.equal(k('f1') + k('f2Counted') + k('burnUnresolvedOrProvisional'), k('burn'), label + ': OP-C outflow + C3..C8 = burn');
  // Each entry: its contributions to the exclusive figures equal its classified amount, once.
  for (const x of m.entries) {
    const c = x.contrib, g = n => K(c[n] || 0);
    let classified;
    if (x.type === 'expense' || x.type === 'obligation') classified = g('f1') + g('f2') + g('f3') + g('f4') + g('personalExpenses') + g('unresolvedSpending');
    else if (x.type === 'income') classified = g('pharmacyReceipts') + g('personalIncome') + g('unresolvedIncome');
    else if (x.kind === 'loan_repayment') classified = g('principalRepaid') + g('b1') + g('personalExpenses') + g('unresolvedFinanceCost') + g('provisionalRepayments');
    else classified = g('loanReceipts') + g('externalFunding') + g('internalMovements') + g('unresolvedAccountMovements') + g('capitalInjectionsSourceUnconfirmed') + g('otherEntries')
      + (x.kind === 'owner_withdrawal' ? g('ownerWithdrawals') : 0) + (x.kind === 'owner_contribution' ? g('ownerContributions') : 0);
    const amount = x.components ? K(x.components.principal) + K(x.components.financeCost.pharmacy) + K(x.components.financeCost.personal) + K(x.components.financeCost.unclassified) + K(x.components.repaymentSplitPending) : K(x.parts.pharmacy) + K(x.parts.personal) + K(x.parts.unclassified);
    assert.equal(classified, amount, `${label}: entry ${x.id} (${x.desc}) counted exactly once`);
    // OP-R, OP-C, the difference and the separate lines never mix (3E.2 identity 4).
    if (g('opCash')) assert.equal(g('f3') + g('f4') + g('f2NotCounted') + g('f2PreOpening') + g('burnUnresolvedOrProvisional') + g('incomeNotConfirmedCash') + g('incomeOtherAccount') + g('incomeNoAccount'), 0, `${label}: entry ${x.id}: OP-C holds only line (i), F1 and C2`);
    if (g('burnUnresolvedOrProvisional')) assert.equal(g('opResult') + g('opCash'), 0, `${label}: entry ${x.id}: unresolved or provisional amounts are in neither total`);
  }
}

test('CF2 identities 1–4 (3E.2) and 3C.3 identities 1–5 on every Stage 2 fixture and a generated grid, in kobo', () => {
  identities(F.financialMeasures(ACCTS3B(), fixture3B(false), OPTS3B), '3B');
  identities(F.financialMeasures(ACCTS3B(), fixture3B(true).concat(incomes3E()), OPTS3B), '3E Shared');
  // Grid: every type × paying side × classification × allocation shape (plan 3C.5 item 2).
  nid = 5000; const grid = [], sides = ['opay', 'sh', 'pb', 'un', '', 'pers_bank', 'nowhere'];
  const cls = [{}, { purpose: 'pharmacy' }, { purpose: 'personal' }, { purpose: 'unclassified' }, { split: { method: 'amount', pharmacy: 50, personal: 73.45 } }];
  for (const type of ['expense', 'obligation', 'income']) for (const s of sides) for (const c of cls)
    grid.push(e({ type, amount: 123.45, fromAcct: type === 'income' ? '' : s, toAcct: type === 'income' ? s : '', ...c, date: '2026-11-0' + (1 + grid.length % 9) }));
  for (const s of ['opay', 'sh', 'pb', '']) for (const al of [{ principal: 100, interest: 13.45, fees: 10 }, { principal: 0, interest: 0, fees: 0, unsplit: 123.45 }, null])
    grid.push(e({ type: 'loan_repayment', amount: 123.45, fromAcct: s, alloc: al || undefined, ...(al && al.unsplit ? { allocMode: 'provisional' } : {}) }));
  for (const [a, b] of [['opay', 'tb'], ['opay', 'pb'], ['pb', 'opay'], ['sh', 'opay'], ['pers_bank', 'opay'], ['opay', '']]) grid.push(e({ type: 'transfer', amount: 123.45, fromAcct: a, toAcct: b }));
  grid.push(e({ type: 'loan_receipt', amount: 123.45, toAcct: 'opay' }), e({ type: 'capital_injection', amount: 123.45, toAcct: 'opay', fundingKind: 'equity' }), e({ type: 'capital_injection', amount: 123.45, toAcct: 'opay' }), e({ type: 'mystery', amount: 123.45 }));
  grid.push(e({ amount: 999, fromAcct: 'opay', date: '2026-09-15' }), e({ amount: 999, fromAcct: 'sh', purpose: 'pharmacy', date: '2026-09-15' }), inc({ amount: 999, toAcct: 'opay', date: '2026-09-15' }));
  const gm = F.financialMeasures(ACCTS3B(), grid, { ...OPTS3B, from: '2026-09-01', to: '2026-11-30' });
  identities(gm, 'grid');
  // The Stage 1 exclusive buckets still conserve every kobo (the invariant P-D18 extends, never loosens).
  assert.equal(Object.values(gm.scope.exclusive).reduce((s, v) => s + K(v), 0), grid.reduce((s, t) => s + (t.type === 'loan_repayment' && !(Number(t.amount) > 0) ? 0 : K(t.amount)), 0));
});

test('CF3 funding switch: the same ₦6,000 pharmacy expense paid from Business, then Personal, then Outside — B1 and OP-R unchanged; burn and OP-C move only in the Business case; the difference line absorbs F3 or F4', () => {
  const OPTS = { ...OPTS3B, buckets: [] }, base = [];
  const run = from => { nid = 900; return F.financialMeasures(ACCTS3B(), [e({ amount: 6000, fromAcct: from, purpose: 'pharmacy', date: '2026-11-02' })], OPTS); };
  const none = F.financialMeasures(ACCTS3B(), base, OPTS);
  const r = { business: run('opay'), personal: run('pb'), outside: run('') };
  for (const [k, m] of Object.entries(r)) {
    assert.equal(m.figures.b1, 6000, k); assert.equal(F.cashFlowStatement(m).operatingResult, -6000, k + ': OP-R includes every funding source');
  }
  assert.deepEqual([r.business.figures.f1, r.personal.figures.f3, r.outside.figures.f4], [6000, 6000, 6000]);
  assert.deepEqual([r.business.pharmacyCashBurn, r.personal.pharmacyCashBurn, r.outside.pharmacyCashBurn], [6000, 0, 0]);
  assert.deepEqual([F.cashFlowStatement(r.business).operatingCash, F.cashFlowStatement(r.personal).operatingCash, F.cashFlowStatement(r.outside).operatingCash], [-6000, 0, 0]);
  assert.deepEqual([F.cashFlowStatement(r.personal).difference.total, F.cashFlowStatement(r.outside).difference.total], [-6000, -6000]);
  // Available cash (cash layer) moves only in the Business case.
  assert.equal(none.confirmedPharmacyCash.available - r.business.confirmedPharmacyCash.available, 6000);
  assert.equal(none.confirmedPharmacyCash.available - r.personal.confirmedPharmacyCash.available, 0);
  assert.equal(none.confirmedPharmacyCash.available - r.outside.confirmedPharmacyCash.available, 0);
});

test('CF4 receiving switch: the same ₦10,000 pharmacy income into confirmed Business, then Shared (split), then no account — OP-R unchanged; OP-C rises only in the confirmed Business case', () => {
  const OPTS = { ...OPTS3B, buckets: [] };
  const run = o => { nid = 950; return F.cashFlowStatement(F.financialMeasures(ACCTS3B(), [inc({ amount: 10000, date: '2026-11-02', ...o })], OPTS)); };
  const b = run({ toAcct: 'opay' }), s = run({ toAcct: 'sh', split: { method: 'amount', pharmacy: 10000, personal: 0 } }), n = run({ toAcct: '', purpose: 'pharmacy' });
  assert.deepEqual([b.operatingResult, s.operatingResult, n.operatingResult], [10000, 10000, 10000]);
  assert.deepEqual([b.operatingCash, s.operatingCash, n.operatingCash], [10000, 0, 0]);
  assert.deepEqual([s.operatingResultParts.incomeOtherAccount, n.operatingResultParts.incomeNoAccount], [10000, 10000]);
});

test('CF5 (owner-approved correction): a ₦5,000 payment explicitly marked purpose unknown from a confirmed Business account stays unresolved — OP-R and OP-C unchanged; the separate line rises ₦5,000; the burn rises ₦5,000 (C3)', () => {
  const OPTS = { ...OPTS3B, buckets: [] };
  nid = 970; const base = [e({ amount: 40000, fromAcct: 'opay', date: '2026-11-02' }), inc({ amount: 90000, toAcct: 'opay', date: '2026-11-02' })];
  const m0 = F.financialMeasures(ACCTS3B(), base, OPTS);
  const unknown = e({ amount: 5000, fromAcct: 'opay', purpose: 'unclassified', desc: 'Purpose unknown', date: '2026-11-03' });
  const m1 = F.financialMeasures(ACCTS3B(), base.concat(unknown), OPTS);
  const c0 = F.cashFlowStatement(m0), c1 = F.cashFlowStatement(m1);
  assert.equal(m1.entries.find(x => x.id === unknown.id).kind, 'unclassified', 'explicitly unknown: unresolved (Stage 1 Example 15)');
  assert.equal(c1.operatingResult, c0.operatingResult); assert.equal(c1.operatingCash, c0.operatingCash);
  assert.equal(c1.separate.unresolvedOrProvisionalBusiness - c0.separate.unresolvedOrProvisionalBusiness, 5000);
  assert.equal(m1.pharmacyCashBurn - m0.pharmacyCashBurn, 5000); assert.equal(m1.figures.unresolvedSpendingBusiness, 5000);
  // The same check for income explicitly marked purpose unknown into a confirmed Business account.
  const ui = inc({ amount: 2500, toAcct: 'opay', purpose: 'unclassified', date: '2026-11-04' });
  const c2 = F.cashFlowStatement(F.financialMeasures(ACCTS3B(), base.concat(ui), OPTS));
  assert.equal(c2.operatingResult, c0.operatingResult); assert.equal(c2.operatingCash, c0.operatingCash);
  assert.equal(c2.separate.unresolvedIncomeConfirmedPharmacy, 2500);
  // Contrast (Stage 1 rule 4, unchanged): a payment with NO purpose from a confirmed Business account is pharmacy (F1),
  // so it is in both OP-R and OP-C, once.
  nid = 990; const noPurpose = e({ amount: 5000, fromAcct: 'opay', date: '2026-11-03' });
  const m2 = F.financialMeasures(ACCTS3B(), base.concat(noPurpose), OPTS), c3 = F.cashFlowStatement(m2);
  assert.equal(m2.entries.find(x => x.id === noPurpose.id).basis, 'account_ownership');
  assert.equal(c0.operatingResult - c3.operatingResult, 5000); assert.equal(c0.operatingCash - c3.operatingCash, 5000);
  assert.equal(c3.separate.unresolvedOrProvisionalBusiness, 0);
});

/* ── 3A: the income partition ── */
test('3A income partition grid: receiving side × date × From side × classification — each pharmacy part lands in exactly one of (i)–(iv), they sum to pharmacy receipts, nothing is omitted', () => {
  nid = 2000; const grid = [];
  const recv = ['', 'opay', 'sh', 'pb', 'un', 'nc', 'pers_bank', '__outside'];
  for (const to of recv) for (const date of ['2026-09-20', '2026-09-30', '2026-11-05']) for (const from of ['', 'pers_bank'])
    for (const c of [{ purpose: 'pharmacy' }, { split: { method: 'amount', pharmacy: 600, personal: 400 } }, {}])
      grid.push(inc({ amount: 1000, toAcct: to, fromAcct: from, date, ...c }));
  const A = ACCTS3B().concat([acct('nc', '', { opening: 0 })]);
  const m = F.financialMeasures(A, grid, { ...OPTS3B, from: '2026-09-01', to: '2026-11-30' });
  const lines = ['incomeCashReceived', 'incomeNotConfirmedCash', 'incomeOtherAccount', 'incomeNoAccount'];
  let n = 0;
  for (const x of m.entries) {
    const ph = K(x.parts.pharmacy), hit = lines.filter(l => x.contrib[l]);
    if (ph === 0) { assert.equal(hit.length, 0); continue; }
    n++;
    assert.equal(hit.length, 1, `entry ${x.id}: exactly one category`); assert.equal(K(x.contrib[hit[0]]), ph, `entry ${x.id}: its whole pharmacy part`);
    // The independent rule (plan 3A): (iv) missing; (ii) confirmed Business and (pre-opening or held); (i) confirmed Business; (iii) otherwise.
    const t = grid.find(g => g.id === x.id), pre = t.date < OPTS3B.baselineDate, held = t.toAcct === 'opay' && t.fromAcct === 'pers_bank' && !pre;
    const want = !t.toAcct ? 'incomeNoAccount' : t.toAcct === 'opay' ? (pre || held ? 'incomeNotConfirmedCash' : 'incomeCashReceived') : 'incomeOtherAccount';
    assert.equal(hit[0], want, `entry ${x.id} (${t.toAcct || 'none'}, ${t.date}, from ${t.fromAcct || 'none'})`);
  }
  assert.ok(n > 30);
  const f = m.figures;
  assert.equal(K(f.incomeCashReceived) + K(f.incomeNotConfirmedCash) + K(f.incomeOtherAccount) + K(f.incomeNoAccount), K(f.pharmacyReceipts));
  // Duplication: summing the four categories over the entries never exceeds the entries' total pharmacy parts.
  assert.equal(m.entries.reduce((s, x) => s + lines.reduce((t, l) => t + K(x.contrib[l] || 0), 0), 0), m.entries.reduce((s, x) => s + K(x.parts.pharmacy), 0));
});

test('3A worked example (worksheet W6): recorded ₦54,100 = (i) ₦50,000 + (iv) ₦4,100; confirmed pharmacy cash received ₦50,000 only; line (i) matches the confirmed Business balance change from income', () => {
  nid = 3000; const A = ACCTS3B();
  const x = [inc({ amount: 50000, toAcct: 'opay', desc: 'Sales', date: '2026-11-06' }), inc({ amount: 3500, toAcct: '', purpose: 'pharmacy', date: '2026-11-06' }),
    inc({ amount: 1000, toAcct: '', split: { method: 'amount', pharmacy: 600, personal: 400 }, date: '2026-11-06' })];
  const m = F.financialMeasures(A, x, { ...OPTS3B, buckets: [] }), f = m.figures;
  assert.deepEqual([f.pharmacyReceipts, f.incomeCashReceived, f.incomeNotConfirmedCash, f.incomeOtherAccount, f.incomeNoAccount], [54100, 50000, 0, 0, 4100]);
  const before = F.accountBalances(A, [], { baselineDate: OPTS3B.baselineDate }), after = F.accountBalances(A, x, { baselineDate: OPTS3B.baselineDate });
  assert.equal((after.opay - before.opay) + (after.tb - before.tb), f.incomeCashReceived);
});

/* ── 3C.5: one line at a time, mixed repayment, pre-opening parts ── */
test('3C.5 one line at a time: each fixture makes exactly its own line non-zero, with the expected burn', () => {
  const OPTS = { ...OPTS3B, buckets: [] }, lines = ['f1', 'f2', 'f3', 'f4', 'unresolvedSpendingBusiness', 'unresolvedSpendingShared', 'unresolvedFinanceCostBusiness', 'unresolvedFinanceCostShared', 'provisionalBusiness', 'provisionalShared'];
  const cases = [
    ['f1', e({ amount: 4000, fromAcct: 'opay', purpose: 'pharmacy' }), 4000],
    ['f2', e({ amount: 4000, fromAcct: 'sh', purpose: 'pharmacy' }), 0],          // ₦119,000 → ₦115,000 stays above D: C2 0
    ['f3', e({ amount: 4000, fromAcct: 'pb', purpose: 'pharmacy' }), 0],
    ['f4', e({ amount: 4000, fromAcct: '__outside', purpose: 'pharmacy' }), 0],
    ['unresolvedSpendingBusiness', e({ amount: 4000, fromAcct: 'opay', purpose: 'unclassified' }), 4000],
    ['unresolvedSpendingShared', e({ amount: 4000, fromAcct: 'sh' }), 4000],
    ['unresolvedFinanceCostBusiness', e({ type: 'loan_repayment', amount: 4000, fromAcct: 'opay', alloc: { principal: 0, interest: 4000, fees: 0 } }), 4000],
    ['unresolvedFinanceCostShared', e({ type: 'loan_repayment', amount: 4000, fromAcct: 'sh', alloc: { principal: 0, interest: 4000, fees: 0 } }), 4000],
    ['provisionalBusiness', e({ type: 'loan_repayment', amount: 4000, fromAcct: 'opay', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 4000 }, allocMode: 'provisional' }), 4000],
    ['provisionalShared', e({ type: 'loan_repayment', amount: 4000, fromAcct: 'sh', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 4000 }, allocMode: 'provisional' }), 4000],
  ];
  for (const [line, t, burn] of cases) {
    const m = F.financialMeasures(ACCTS3B(), [t], OPTS);
    for (const l of lines) assert.equal(m.figures[l], l === line ? 4000 : 0, `${line}: ${l}`);
    assert.equal(m.pharmacyCashBurn, burn, `${line}: burn`);
  }
});

test('3C.5 mixed repayment: ₦4,000 = principal ₦3,000 + interest ₦500 + unsplit ₦500 from Business → C5 +₦500, C7 +₦500, burn +₦1,000; principal never burn', () => {
  nid = 4000; const m = F.financialMeasures(ACCTS3B(), [e({ type: 'loan_repayment', amount: 4000, fromAcct: 'opay', alloc: { principal: 3000, interest: 500, fees: 0, unsplit: 500 } })], { ...OPTS3B, buckets: [] });
  assert.deepEqual([m.figures.unresolvedFinanceCostBusiness, m.figures.provisionalBusiness, m.figures.principalRepaid, m.pharmacyCashBurn], [500, 500, 3000, 1000]);
});

test('3C.5 pre-opening "of which" parts stay inside their parent and are never added again; reclassification moves an amount between lines without changing the burn twice', () => {
  nid = 4100; const OPTS = { ...OPTS3B, buckets: [], from: '2026-09-01', to: '2026-11-30' };
  const pre = e({ amount: 3000, fromAcct: 'opay', purpose: 'unclassified', date: '2026-09-20' }), post = e({ amount: 2000, fromAcct: 'opay', purpose: 'unclassified', date: '2026-10-20' });
  const m = F.financialMeasures(ACCTS3B(), [pre, post], OPTS);
  assert.equal(m.unresolvedSpendingPharmacyAccounts, 5000); assert.equal(m.unresolvedSpendingPharmacyAccountsPreOpening, 3000); assert.equal(m.pharmacyCashBurn, 5000);
  // Classifying the unknown payment later as Pharmacy moves it from C3 to C1 (F1); the burn is unchanged.
  const m2 = F.financialMeasures(ACCTS3B(), [pre, { ...post, purpose: 'pharmacy' }], OPTS);
  assert.equal(m2.pharmacyCashBurn, 5000); assert.equal(m2.figures.f1, 2000); assert.equal(m2.figures.unresolvedSpendingBusiness, 3000);
  // As Personal it leaves the burn (an owner withdrawal): never counted twice.
  const m3 = F.financialMeasures(ACCTS3B(), [pre, { ...post, purpose: 'personal' }], OPTS);
  assert.equal(m3.pharmacyCashBurn, 3000); assert.equal(m3.ownerWithdrawals, 2000);
});

/* ── Derivations: budgets, daily totals, burn report, explanations (R10) ── */
test('budgetConsumption: classified pharmacy and personal spending by category, shown apart; unresolved shown, never consumed; financing, principal, transfers and withdrawals never consumption', () => {
  const m = F.financialMeasures(ACCTS3B(), fixture3B(false), OPTS3B);
  const b = F.budgetConsumption([{ cat: 'Restocking', amount: 300000 }, { cat: 'Food', amount: 100000 }, { cat: 'Other', amount: 50000 }], m);
  assert.deepEqual(b.find(x => x.cat === 'Restocking'), { cat: 'Restocking', amount: 300000, pharmacy: 215000, personal: 0, used: 215000, unresolved: 0, pct: 72 });
  assert.deepEqual(b.find(x => x.cat === 'Food'), { cat: 'Food', amount: 100000, pharmacy: 0, personal: 60000, used: 60000, unresolved: 0, pct: 60 });
  const other = b.find(x => x.cat === 'Other');
  assert.equal(other.used, 0, 'the withdrawal, repayments (principal, interest, provisional) and unresolved payments are not consumption');
  assert.equal(other.unresolved, 45000 + 9000 + 12000, 'unresolved spending in the category is shown');
});

test('dailyTotals: per date, pharmacy, personal and unresolved income and spending; the days sum to the period figures (R1, R9)', () => {
  const m = F.financialMeasures(ACCTS3B(), fixture3B(true).concat(incomes3E()), OPTS3B), d = F.dailyTotals(m);
  const sum = k => Object.values(d).reduce((s, x) => s + K(x[k]), 0);
  assert.equal(sum('pharmacyIn'), K(m.figures.pharmacyReceipts)); assert.equal(sum('pharmacyOut'), K(m.figures.b1));
  assert.equal(sum('personalIn'), K(m.figures.personalIncome)); assert.equal(sum('personalOut'), K(m.figures.personalExpenses));
  assert.equal(sum('unresolvedIn'), K(m.figures.unresolvedIncome)); assert.equal(sum('unresolvedOut'), K(m.figures.unresolvedSpending) + K(m.figures.unresolvedFinanceCost));
  assert.deepEqual(d['2026-10-21'], { date: '2026-10-21', pharmacyIn: 0, pharmacyOut: 15000, personalIn: 0, personalOut: 0, unresolvedIn: 0, unresolvedOut: 0, pharmacyNet: -15000 });
});

test('R10 explain: for every figure, the contributing entries sum exactly to the figure (period and runway window); OP-C entries carry their replay rows', () => {
  const m = F.financialMeasures(ACCTS3B(), fixture3B(true).concat(incomes3E()), OPTS3B);
  for (const key of F.FIGURE_KEYS) {
    const x = F.explain(m, key); assert.equal(K(x.total), K(m.figures[key]), key);
    const w = F.explain(m, key, { entries: m.runway.entries }); assert.equal(K(w.total), K(m.runway.figures[key]), 'window ' + key);
  }
  const oc = F.explain(m, 'opCash'), c2 = oc.entries.find(r => r.replay);
  assert.ok(c2 && c2.replay.c2 === 20000 && c2.replay.portionAfter === 0, 'the C2 payment shows its replay row');
  // Identity 6: the burn report total = the runway burn = the explanation sum, for the same window.
  assert.equal(K(F.burnReport(m, { window: true }).burn), K(m.runway.burn));
  assert.equal(K(F.explain(m, 'burn', { entries: m.runway.entries }).total), K(m.runway.burn));
});

test('read-only and deterministic: inputs never change; the same input gives the same output; no stored field is added', () => {
  const A = ACCTS3B(), x = fixture3B(true).concat(incomes3E()), a0 = JSON.stringify(A), x0 = JSON.stringify(x);
  const m1 = F.financialMeasures(A, x, OPTS3B), m2 = F.financialMeasures(A, x, OPTS3B);
  F.cashFlowStatement(m1); F.budgetConsumption([{ cat: 'Food', amount: 1 }], m1); F.dailyTotals(m1); F.burnReport(m1); F.explain(m1, 'burn');
  assert.equal(JSON.stringify(A), a0); assert.equal(JSON.stringify(x), x0); assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  for (const t of x) assert.deepEqual(F.newFinancialFields('transactions', { id: t.id, type: t.type, amount: t.amount }), []);
});

/* ── Scenarios at engine level (plan 5): B personal, D financing, E transfers, F owner, K dates, L missing data ── */
test('Scenarios B, D, E, F: personal never in pharmacy figures; financing never income or spending; transfers never income or spending; owner movements once', () => {
  nid = 6000; const OPTS = { ...OPTS3B, buckets: [] };
  const x = [e({ amount: 8000, fromAcct: 'pb', desc: 'Personal spend' }), inc({ amount: 9000, toAcct: 'pb', desc: 'Personal income' }),
    e({ type: 'loan_receipt', amount: 100000, toAcct: 'tb' }), e({ type: 'capital_injection', amount: 30000, toAcct: 'tb', fundingKind: 'equity' }), e({ type: 'capital_injection', amount: 20000, toAcct: 'tb' }),
    e({ type: 'transfer', amount: 15000, fromAcct: 'opay', toAcct: 'tb' }), e({ type: 'transfer', amount: 7000, fromAcct: 'pb', toAcct: 'opay' }), e({ type: 'owner_withdrawal', amount: 11000, fromAcct: 'opay', toAcct: 'pb' }),
    e({ amount: 2500, fromAcct: 'opay', purpose: 'personal', desc: 'Personal paid from pharmacy' }), e({ amount: 3500, fromAcct: 'pb', purpose: 'pharmacy', desc: 'Pharmacy paid personally' })];
  const m = F.financialMeasures(ACCTS3B(), x, OPTS), f = m.figures;
  assert.deepEqual([f.pharmacyReceipts, f.b1, f.f3, m.pharmacyCashBurn], [0, 3500, 3500, 0]);
  assert.deepEqual([f.personalIncome, f.personalExpenses], [9000, 8000 + 2500]);
  assert.deepEqual([f.loanReceipts, f.externalFunding, f.capitalInjectionsSourceUnconfirmed, f.internalMovements], [100000, 30000, 20000, 15000]);
  assert.deepEqual([f.ownerWithdrawals, f.ownerContributions, f.implicitOwnerContribution], [11000 + 2500, 7000 + 3500, 3500]);
  assert.equal(f.allRecordedIncome, 9000, 'financing, funding and transfers are never income');
});

test('Scenario K dates: the period is inclusive at both ends; month-boundary entries land in their own month; an empty period gives zeros', () => {
  nid = 7000; const OPTS = { ...OPTS3B, buckets: [] };
  const x = [e({ amount: 1000, fromAcct: 'opay', date: '2026-10-31' }), e({ amount: 2000, fromAcct: 'opay', date: '2026-11-01' }), e({ amount: 4000, fromAcct: 'opay', date: '2026-11-30' })];
  const oct = F.financialMeasures(ACCTS3B(), x, { ...OPTS, from: '2026-10-01', to: '2026-10-31' }), nov = F.financialMeasures(ACCTS3B(), x, { ...OPTS, from: '2026-11-01', to: '2026-11-30' });
  assert.equal(oct.figures.f1, 1000); assert.equal(nov.figures.f1, 6000);
  const empty = F.financialMeasures(ACCTS3B(), x, { ...OPTS, from: '2026-12-01', to: '2026-12-31' });
  assert.ok(F.FIGURE_KEYS.every(k => empty.figures[k] === 0));
});
