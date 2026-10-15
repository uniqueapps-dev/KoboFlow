// Unit tests for the KoboFlow finance engine (pure functions in koboflow.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./load-engine')();

const TODAY = '2026-10-15';
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

// Turns a schedule into stored instalment records the way the app does.
function store(agrId, sched) {
  return sched.instalments.map(r => ({ id: `${agrId}_v1_${r.seq}`, agreementId: agrId, ...r }));
}
function allocRows(agrId, txnId, plan) {
  return plan.rows.map((r, k) => ({ id: `al_${txnId}_${k}`, agreementId: agrId, txnId, reversed: false, ...r }));
}
const EASI_TERMS = { nature: 'debt', structure: 'equal_instalment', principal: 150000, cashReceived: 150000,
  instalmentAmount: 55455, count: 4, frequency: 'monthly', firstDueDate: '2026-11-15', method: 'lender' };

/* ───────────── Agreement calculations ───────────── */
test('EasiMoni fixture: contractual instalments give exact totals and 47.88% cost', () => {
  const s = F.buildSchedule(EASI_TERMS);
  assert.equal(s.ok, true);
  assert.equal(s.basis, 'contract');
  assert.equal(s.instalments.length, 4);
  s.instalments.forEach(r => assert.equal(r.total, 55455));
  assert.equal(s.totals.total, 221820);
  assert.equal(s.totals.principal, 150000);
  assert.equal(s.totals.interest, 71820);
  const t = F.termsSummary(EASI_TERMS, s);
  assert.equal(t.financingCost, 71820);
  assert.equal(t.costPctOfCash, 47.88);
  assert.deepEqual(s.instalments.map(r => r.dueDate), ['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15']);
});

test('fixed total repayment splits evenly, last instalment absorbs rounding', () => {
  const s = F.buildSchedule({ structure: 'equal_instalment', principal: 100000, contractualTotal: 100000.01, count: 3, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.equal(s.ok, true);
  assert.equal(s.totals.total, 100000.01);
  assert.deepEqual(s.instalments.map(r => r.total), [33333.33, 33333.33, 33333.35]);
});

test('flat interest: 5% per month on 100,000 over 4 months', () => {
  const s = F.buildSchedule({ structure: 'equal_instalment', principal: 100000, rate: 5, ratePeriod: 'monthly', method: 'flat', count: 4, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.equal(s.totals.interest, 20000);
  assert.equal(s.totals.total, 120000);
  s.instalments.forEach(r => assert.equal(r.total, 30000));
});

test('reducing balance: 24% p.a. on 100,000 over 12 months amortises to zero', () => {
  const s = F.buildSchedule({ structure: 'equal_instalment', principal: 100000, rate: 24, ratePeriod: 'annually', method: 'reducing', count: 12, frequency: 'monthly', firstDueDate: '2026-01-31' });
  near(s.instalments[0].total, 9455.96);
  assert.equal(s.totals.principal, 100000);
  near(s.totals.interest, 13471.53, 0.05);
  // first month interest = 2% of 100,000
  assert.equal(s.instalments[0].interest, 2000);
  // month-end clamping: Jan 31 → Feb 28
  assert.equal(s.instalments[1].dueDate, '2026-02-28');
  assert.equal(s.instalments[2].dueDate, '2026-03-31');
});

test('equal principal plus interest on reducing balance', () => {
  const s = F.buildSchedule({ structure: 'equal_principal', principal: 90000, rate: 10, ratePeriod: 'monthly', method: 'reducing', count: 3, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.deepEqual(s.instalments.map(r => r.principal), [30000, 30000, 30000]);
  assert.deepEqual(s.instalments.map(r => r.interest), [9000, 6000, 3000]);
});

test('fees deducted from proceeds: cash received is lower than principal and the fee is part of the cost', () => {
  const terms = { structure: 'equal_instalment', principal: 150000, upfrontFeeDeducted: 7500, instalmentAmount: 55455, count: 4, frequency: 'monthly', firstDueDate: '2026-11-15' };
  assert.equal(F.cashReceived(terms), 142500);
  const s = F.buildSchedule(terms);
  const t = F.termsSummary(terms, s);
  assert.equal(t.principal, 150000);
  assert.equal(t.cashReceived, 142500);
  assert.equal(t.upfrontDeducted, 7500);
  assert.equal(t.financingCost, 221820 - 142500);
});

test('contractual repayment overrides an assumed annual rate and flags the discrepancy', () => {
  const s = F.buildSchedule({ ...EASI_TERMS, rate: 10, ratePeriod: 'annually', method: 'flat' });
  assert.equal(s.totals.total, 221820, 'lender total must be used');
  assert.equal(s.totals.interest, 71820, 'must not fall back to the low rate-based interest');
  assert.ok(s.warnings.some(w => /differs from the rate-based estimate/.test(w)));
});

test('missing terms are refused rather than invented', () => {
  const s = F.buildSchedule({ structure: 'equal_instalment', principal: 100000, count: 4, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.equal(s.ok, false);
  assert.match(s.error, /instalment amount|interest rate|interest-free/);
  const free = F.buildSchedule({ structure: 'equal_instalment', principal: 100000, method: 'none', count: 4, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.equal(free.ok, true);
  assert.equal(free.totals.interest, 0);
});

test('manual irregular schedule: given split is kept; totals-only split is a labelled estimate', () => {
  const known = F.buildSchedule({ structure: 'manual', principal: 100000, manualRows: [
    { dueDate: '2026-12-01', total: 20000, principal: 15000, interest: 5000, fees: 0 },
    { dueDate: '2026-11-05', total: 90000, principal: 85000, interest: 4000, fees: 1000 }] });
  assert.equal(known.ok, true);
  assert.equal(known.splitBasis, 'calculated');
  assert.equal(known.instalments[0].dueDate, '2026-11-05', 'rows sorted by date');
  assert.equal(known.totals.total, 110000);
  const est = F.buildSchedule({ structure: 'manual', principal: 100000, manualRows: [{ dueDate: '2026-11-05', total: 60000 }, { dueDate: '2027-01-05', total: 60000 }] });
  assert.equal(est.splitBasis, 'estimated_pro_rata');
  assert.equal(est.totals.principal, 100000);
  assert.equal(est.totals.total, 120000);
});

test('balloon: interest-only payments then principal at the end', () => {
  const s = F.buildSchedule({ structure: 'interest_only_balloon', principal: 100000, rate: 5, ratePeriod: 'monthly', method: 'simple', count: 3, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.deepEqual(s.instalments.map(r => r.total), [5000, 5000, 105000]);
});

test('bullet with lender total, and instalments plus final lump sum', () => {
  const b = F.buildSchedule({ structure: 'bullet', principal: 200000, contractualTotal: 230000, firstDueDate: '2027-01-15' });
  assert.equal(b.instalments.length, 1);
  assert.equal(b.instalments[0].interest, 30000);
  const f = F.buildSchedule({ structure: 'instalments_plus_final', principal: 100000, instalmentAmount: 5000, finalAmount: 100000, count: 3, frequency: 'monthly', firstDueDate: '2026-11-01' });
  assert.deepEqual(f.instalments.map(r => r.total), [5000, 5000, 5000, 100000]);
  assert.equal(f.instalments[3].principal, 100000);
  assert.equal(f.totals.total, 115000);
});

/* ───────────── Payments, balances, settlement ───────────── */
function easiState() {
  const inst = store('a1', F.buildSchedule(EASI_TERMS));
  return { inst, allocs: [] };
}

test('new agreement: liability equals the contractual total until a payment is recorded', () => {
  const { inst } = easiState();
  const b = F.agreementBalances(EASI_TERMS, inst, [], [], TODAY);
  assert.equal(b.outstanding.total, 221820);
  assert.equal(b.outstanding.principal, 150000);
  assert.equal(b.next.dueDate, '2026-11-15');
});

test('partial payment leaves the remainder of the instalment outstanding', () => {
  const { inst } = easiState();
  const st = F.instalmentStates(inst, [], TODAY);
  const plan = F.allocatePayment(st, 30000, { mode: 'schedule' });
  assert.equal(plan.ok, true);
  const allocs = allocRows('a1', 1, plan);
  const st2 = F.instalmentStates(inst, allocs, TODAY);
  assert.equal(st2[0].status, 'partial');
  assert.equal(st2[0].remaining, 25455);
  // schedule order: fees → interest → principal
  assert.equal(plan.split.interest, 17955);
  assert.equal(plan.split.principal, 12045);
  const b = F.agreementBalances(EASI_TERMS, inst, allocs, [{ type: 'loan_repayment', amount: 30000 }], TODAY);
  assert.equal(b.outstanding.total, 191820);
  assert.equal(b.repaidToDate, 30000);
});

test('paying every instalment settles the agreement exactly', () => {
  const { inst } = easiState();
  let allocs = [];
  for (let k = 0; k < 4; k++) {
    const plan = F.allocatePayment(F.instalmentStates(inst, allocs, TODAY), 55455, { mode: 'schedule' });
    allocs = allocs.concat(allocRows('a1', k + 1, plan));
  }
  const b = F.agreementBalances(EASI_TERMS, inst, allocs, [], TODAY);
  assert.equal(b.outstanding.total, 0);
  assert.equal(b.settled, true);
  assert.equal(b.paid.principal, 150000);
  assert.equal(b.paid.interest, 71820);
  const over = F.allocatePayment(F.instalmentStates(inst, allocs, TODAY), 1, {});
  assert.equal(over.ok, false, 'cannot pay beyond the schedule');
});

test('overdue status uses dates, not payments', () => {
  const { inst } = easiState();
  const st = F.instalmentStates(inst, [], '2026-11-20');
  assert.equal(st[0].status, 'overdue');
  assert.equal(st[1].status, 'upcoming');
  assert.equal(F.instalmentStates(inst, [], '2026-11-10')[0].status, 'due_soon');
  assert.equal(F.instalmentStates(inst, [], '2026-11-15')[0].status, 'due_today');
});

test('manual split must add up; extra principal needs explicit consent', () => {
  const { inst } = easiState();
  const st = F.instalmentStates(inst, [], TODAY);
  assert.equal(F.allocatePayment(st, 55455, { mode: 'manual', principal: 40000, interest: 10000, fees: 0 }).ok, false);
  const ok = F.allocatePayment(st, 55455, { mode: 'manual', principal: 40000, interest: 15455, fees: 0 });
  assert.equal(ok.ok, true);
  assert.equal(ok.split.principal, 40000);
  const tooMuch = F.allocatePayment(st, 200000, { mode: 'manual', principal: 200000, interest: 0, fees: 0 });
  assert.equal(tooMuch.ok, false);
  const allowed = F.allocatePayment(st, 200000, { mode: 'manual', principal: 200000, interest: 0, fees: 0, allowExtra: true });
  assert.equal(allowed.ok, true);
  assert.ok(allowed.rows.some(r => r.kind === 'extra_principal' && r.principal === 50000));
});

test('provisional payment: split unknown is held, not fabricated; total outstanding stays exact', () => {
  const { inst } = easiState();
  const plan = F.allocatePayment(F.instalmentStates(inst, [], TODAY), 55455, { mode: 'provisional' });
  assert.equal(plan.split.principal, 0);
  assert.equal(plan.split.interest, 0);
  assert.equal(plan.split.unsplit, 55455);
  const b = F.agreementBalances(EASI_TERMS, inst, allocRows('a1', 1, plan), [], TODAY);
  assert.equal(b.outstanding.total, 166365);
  assert.equal(b.outstanding.componentsApprox, true);
  assert.equal(b.states[0].status, 'paid');
});

test('extra principal payment reduces principal and total outstanding without rewriting the schedule', () => {
  const { inst } = easiState();
  const plan = F.allocatePayment(F.instalmentStates(inst, [], TODAY), 20000, { mode: 'extra_principal' });
  const b = F.agreementBalances(EASI_TERMS, inst, allocRows('a1', 1, plan), [], TODAY);
  assert.equal(b.outstanding.principal, 130000);
  assert.equal(b.outstanding.total, 201820);
  assert.equal(b.states.length, 4, 'future instalments untouched until amended');
});

test('early settlement: lender figure is applied principal-first; only the shortfall is waived', () => {
  const { inst } = easiState();
  let allocs = allocRows('a1', 1, F.allocatePayment(F.instalmentStates(inst, [], TODAY), 55455, {}));
  const st = F.instalmentStates(inst, allocs, TODAY);
  const plan = F.settlementPlan(st, 120000);
  assert.equal(plan.outstanding, 166365);
  assert.equal(plan.waived, 46365);
  assert.equal(sum(plan.rows, r => r.principal + r.interest + r.fees + r.unsplit), 120000);
  assert.equal(sum(plan.rows, r => r.principal), 112500, 'all remaining principal paid first');
  allocs = allocs.concat(allocRows('a1', 2, plan));
  const waivedInst = inst.map(i => plan.waive.some(w => w.instalmentId === i.id) ? { ...i, waived: true } : i);
  const b = F.agreementBalances(EASI_TERMS, waivedInst, allocs, [], TODAY);
  assert.equal(b.outstanding.total, 0);
  assert.equal(b.settled, true);
  near(b.waived, 46365);
});

test('early settlement above the schedule records the excess as a charge, never silently', () => {
  const { inst } = easiState();
  const plan = F.settlementPlan(F.instalmentStates(inst, [], TODAY), 230000);
  assert.equal(plan.waived, 0);
  assert.equal(plan.settlementCharge, 8180);
});

test('reversing a payment (allocations marked reversed) restores the liability', () => {
  const { inst } = easiState();
  const allocs = allocRows('a1', 1, F.allocatePayment(F.instalmentStates(inst, [], TODAY), 55455, {}));
  assert.equal(F.agreementBalances(EASI_TERMS, inst, allocs, [], TODAY).outstanding.total, 166365);
  const reversed = allocs.map(a => ({ ...a, reversed: true }));
  const b = F.agreementBalances(EASI_TERMS, inst, reversed, [{ type: 'loan_repayment', amount: 55455, voided: true }], TODAY);
  assert.equal(b.outstanding.total, 221820);
  assert.equal(b.repaidToDate, 0);
});

test('superseded instalments (amendments) are excluded but not deleted', () => {
  const { inst } = easiState();
  const amended = inst.map((i, k) => k >= 2 ? { ...i, supersededBy: 'amd1' } : i).concat([
    { id: 'a1_v2_5', agreementId: 'a1', seq: 5, dueDate: '2027-03-15', principal: 75000, interest: 20000, fees: 0, total: 95000 }]);
  const b = F.agreementBalances(EASI_TERMS, amended, [], [], TODAY);
  assert.equal(b.states.length, 3);
  assert.equal(b.outstanding.total, 55455 * 2 + 95000);
});

/* ───────────── Ledger classification ───────────── */
test('loan proceeds increase cash but are never income', () => {
  const c = F.classifyTxn({ type: 'loan_receipt', amount: 150000, toAcct: 'pharma_bank' });
  assert.equal(c.cashIn, 150000);
  assert.equal(c.loanProceeds, 150000);
  assert.equal(c.income, 0);
  const legacy = F.classifyTxn({ type: 'capital_injection', cat: 'Loan', amount: 700000 });
  assert.equal(legacy.loanProceeds, 700000, 'old "loan received" captures are treated as loan proceeds');
  assert.equal(legacy.income, 0);
});

test('loan receipt raises the receiving account balance', () => {
  const accts = [{ id: 'pharma_bank', opening: 312500 }, { id: 'pers_cash', opening: 45000 }];
  const b = F.accountBalances(accts, [{ type: 'loan_receipt', amount: 150000, toAcct: 'pharma_bank' }]);
  assert.equal(b.pharma_bank, 462500);
  assert.equal(b.pers_cash, 45000);
});

test('repayment: principal reduces liability, interest/fees are finance costs, principal is not an expense', () => {
  const c = F.classifyTxn({ type: 'loan_repayment', amount: 55455, alloc: { principal: 37500, interest: 17455, fees: 500, unsplit: 0 } });
  assert.equal(c.cashOut, 55455);
  assert.equal(c.principalRepaid, 37500);
  assert.equal(c.financeCost, 17955);
  assert.equal(c.expense, 0);
  const prov = F.classifyTxn({ type: 'loan_repayment', amount: 55455, alloc: { principal: 0, interest: 0, fees: 0, unsplit: 55455 } });
  assert.equal(prov.unsplitRepaid, 55455);
  assert.equal(prov.financeCost, 0, 'unknown split is not guessed into interest');
});

test('transfers and owner withdrawals are not expenses; balances move between accounts only', () => {
  const t = F.classifyTxn({ type: 'transfer', amount: 10000 });
  assert.equal(t.expense, 0); assert.equal(t.income, 0); assert.equal(t.internal, 10000);
  const w = F.classifyTxn({ type: 'owner_withdrawal', amount: 50000 });
  assert.equal(w.expense, 0); assert.equal(w.ownerOut, 50000);
  const accts = [{ id: 'a', opening: 100 }, { id: 'b', opening: 0 }];
  const b = F.accountBalances(accts, [{ type: 'transfer', amount: 40, fromAcct: 'a', toAcct: 'b' }]);
  assert.equal(b.a + b.b, 100);
});

test('equity, gifts and capital injections are capital, not income or debt', () => {
  ['equity', 'gift', 'capital_injection'].forEach(k => {
    const c = F.classifyTxn({ type: 'capital_injection', fundingKind: k, amount: 1000 });
    assert.equal(c.capitalIn, 1000); assert.equal(c.income, 0); assert.equal(c.loanProceeds, 0);
  });
  assert.equal(F.isDebt({ nature: 'equity' }), false);
  assert.equal(F.isDebt({ nature: 'profit_share' }), false);
  assert.equal(F.isDebt({ nature: 'profit_share', principalRepayable: true }), true);
});

test('scheduled instalments never change account balances; one payment moves cash once', () => {
  const accts = [{ id: 'pharma_bank', opening: 500000 }];
  const receipt = { type: 'loan_receipt', amount: 150000, toAcct: 'pharma_bank' };
  // An overdue scheduled instalment exists, but no payment transaction: balance unchanged.
  assert.equal(F.accountBalances(accts, [receipt]).pharma_bank, 650000);
  const pay = { type: 'loan_repayment', amount: 55455, fromAcct: 'pharma_bank', alloc: { principal: 37500, interest: 17955 } };
  assert.equal(F.accountBalances(accts, [receipt, pay]).pharma_bank, 650000 - 55455);
  // Voided (reversed) payments drop out of the balance.
  assert.equal(F.accountBalances(accts, [receipt, { ...pay, voided: true }]).pharma_bank, 650000);
  // Demo/sample records never touch real balances.
  assert.equal(F.accountBalances(accts, [{ ...receipt, demo: true }]).pharma_bank, 500000);
});

test('forecast keeps committed obligations separate from current cash', () => {
  const f = F.cashForecast({ currentCash: 300000, obligations: [{ remaining: 55455 }, { remaining: 22000 }], expectedInflows: null });
  assert.equal(f.currentCash, 300000, 'cash is not reduced by plans');
  assert.equal(f.committed, 77455);
  assert.equal(f.remainingAfterKnown, 222545);
  assert.equal(f.inflowsKnown, false);
});

test('reminders: one stable key per instalment and level, escalating as the date nears', () => {
  const { inst } = easiState();
  const agr = { id: 'a1', name: 'EasiMoni' };
  const at = d => F.buildReminders([{ agreement: agr, states: F.instalmentStates(inst, [], d) }], d);
  assert.deepEqual(at('2026-10-15').map(r => r.level), []);
  assert.deepEqual(at('2026-11-01').map(r => r.key), ['a1_v1_1:d14']);
  assert.deepEqual(at('2026-11-10').map(r => r.key), ['a1_v1_1:d7']);
  assert.deepEqual(at('2026-11-15').map(r => r.level), ['today']);
  assert.deepEqual(at('2026-11-16').map(r => r.level), ['overdue']);
  assert.deepEqual(at('2027-02-05').map(r => r.level).sort(), ['maturity', 'overdue', 'overdue', 'overdue']);
});

/* ───────────── Opportunity analyzer ───────────── */
const EASI_OPP = { name: 'EasiMoni', oppType: 'loan_offer', receiveType: 'cash', valueReceived: 150000, receiptDate: '2026-10-15',
  use: 'trading', conversionDays: 30, recovery: 'gradual', structure: 'fixed_total', instalmentAmount: 55455, count: 4,
  frequency: 'monthly', firstDueDate: '2026-11-15' };

test('EasiMoni opportunity: ₦90,000 profit leaves ₦18,180, labelled an estimate; thin margin → REVIEW', () => {
  const r = F.analyzeOpportunity({ ...EASI_OPP, expectedProfit: 90000 }, { freeCash: 100000 });
  assert.equal(r.totalRepay, 221820);
  assert.equal(r.financingCost, 71820);
  assert.equal(r.cfo.costPctOfValue, 47.88);
  assert.equal(r.surplus, 18180);
  assert.equal(r.verdict, 'review', 'a positive surplus alone is not "safe"');
  assert.ok(r.reasons.some(x => /Thin margin/.test(x)));
  assert.ok(r.cfo.annualisedCost > 300 && r.cfo.annualisedCost < 700, 'IRR-based annual cost, not the 47.88% term cost');
  assert.equal(r.timingKnown, true);
  assert.equal(r.maxShortfall, 0);
});

test('no profit estimate: surplus cannot be determined and nothing is invented', () => {
  const r = F.analyzeOpportunity({ ...EASI_OPP, expectedProfit: null }, { freeCash: 100000 });
  assert.equal(r.surplus, null);
  assert.equal(r.profit, null);
  assert.equal(r.financingCost, 71820);
  assert.equal(r.verdict, 'review');
});

test('positive and negative trading profit', () => {
  const good = F.analyzeOpportunity({ ...EASI_OPP, expectedProfit: 160000 }, { freeCash: 100000 });
  assert.equal(good.surplus, 88180);
  assert.equal(good.verdict, 'good');
  const bad = F.analyzeOpportunity({ ...EASI_OPP, expectedProfit: 50000 }, { freeCash: 100000 });
  assert.equal(bad.surplus, -21820);
  assert.equal(bad.verdict, 'bad');
});

test('missing contractual terms → REVIEW with "cannot determine"', () => {
  const r = F.analyzeOpportunity({ ...EASI_OPP, instalmentAmount: null, total: null, expectedProfit: 90000 }, {});
  assert.equal(r.totalRepay, null);
  assert.equal(r.surplus, null);
  assert.equal(r.verdict, 'review');
  assert.ok(r.missing.some(m => /total amount/.test(m)));
});

test('positive profit but cash comes back too late for the first instalment → BAD when other cash cannot cover', () => {
  const o = { ...EASI_OPP, conversionDays: 90, recovery: 'end', expectedProfit: 160000 };
  const r = F.analyzeOpportunity(o, { freeCash: 20000 });
  assert.ok(r.surplus > 0);
  assert.ok(r.maxShortfall > 0);
  assert.equal(r.coverage[0].recovered, 0);
  assert.equal(r.verdict, 'bad');
  const covered = F.analyzeOpportunity(o, { freeCash: 500000 });
  assert.equal(covered.verdict, 'review', 'coverable from existing cash, but still a timing risk');
});

test('cash conversion after the final repayment date is flagged', () => {
  // Gradual sales keep pace with payments, but full conversion ends after the last due date → at least REVIEW.
  const gradual = F.analyzeOpportunity({ ...EASI_OPP, conversionDays: 150, expectedProfit: 160000 }, { freeCash: 0 });
  assert.ok(gradual.reasons.some(x => /only after the final repayment/.test(x)));
  assert.equal(gradual.maxShortfall, 0);
  assert.equal(gradual.verdict, 'review');
  // If cash only comes back at the end, every instalment is uncovered.
  const lump = F.analyzeOpportunity({ ...EASI_OPP, conversionDays: 150, recovery: 'end', expectedProfit: 160000 }, { freeCash: 0 });
  assert.equal(lump.maxShortfall, 221820);
  assert.equal(lump.verdict, 'bad');
});

test('stock received is not cash available for repayment', () => {
  const r = F.analyzeOpportunity({ ...EASI_OPP, receiveType: 'stock', expectedProfit: 160000 }, { freeCash: 100000 });
  assert.equal(r.cashNow, 0);
  assert.equal(r.stockValue, 150000);
  assert.equal(r.cfo.annualisedCost, null, 'no IRR without a cash receipt');
  assert.ok(r.reasons.some(x => /Stock is not cash/.test(x)));
});

test('consignment: settle after sale', () => {
  const r = F.analyzeOpportunity({ name: 'Consignment', oppType: 'other', receiveType: 'stock', valueReceived: 100000, receiptDate: '2026-10-15',
    use: 'trading', conversionDays: 30, structure: 'settle_after_sale', settleAmount: 110000, settleDays: 45, expectedProfit: 25000 }, { freeCash: 0 });
  assert.equal(r.totalRepay, 110000);
  assert.equal(r.financingCost, 10000);
  assert.equal(r.surplus, 15000);
  assert.equal(r.repayments[0].date, '2026-11-29');
  assert.equal(r.maxShortfall, 0);
});

test('profit-sharing agreement', () => {
  const base = { name: 'Partner', oppType: 'investor', receiveType: 'cash', valueReceived: 100000, receiptDate: '2026-10-15', use: 'trading', conversionDays: 60, structure: 'profit_share', sharePct: 40 };
  const r = F.analyzeOpportunity({ ...base, expectedProfit: 50000, principalReturned: true }, { freeCash: 0 });
  assert.equal(r.totalRepay, 120000);
  assert.equal(r.financingCost, 20000);
  assert.equal(r.surplus, 30000);
  const noProfit = F.analyzeOpportunity({ ...base, expectedProfit: null }, {});
  assert.equal(noProfit.totalRepay, null);
  assert.ok(noProfit.missing.some(m => /profit/.test(m)));
  const terms = F.oppToTerms({ ...base, principalReturned: false });
  assert.equal(terms.nature, 'profit_share');
  assert.equal(F.isDebt(terms), false, 'profit share without a duty to repay is not debt');
});

test('equity investment: no repayment, no naira cost, always REVIEW', () => {
  const r = F.analyzeOpportunity({ name: 'Angel', oppType: 'investor', receiveType: 'cash', valueReceived: 1000000, receiptDate: '2026-10-15', use: 'hold', structure: 'equity', expectedProfit: 300000 }, {});
  assert.equal(r.totalRepay, null);
  assert.equal(r.financingCost, null);
  assert.equal(r.surplus, null);
  assert.equal(r.verdict, 'review');
  assert.equal(F.oppToTerms({ structure: 'equity', valueReceived: 1 }).nature, 'equity');
});

test('opportunity → agreement terms keep the lender figures', () => {
  const t = F.oppToTerms(EASI_OPP);
  const s = F.buildSchedule(t);
  assert.equal(s.ok, true);
  assert.equal(s.totals.total, 221820);
  assert.equal(t.cashReceived, 150000);
});

test('manual schedule text parser', () => {
  const p = F.parseManualRows('2026-11-15 55,455\n\nbad line\n2026-12-15 60000 50000 9000 1000');
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].total, 55455);
  assert.equal(p.rows[1].fees, 1000);
  assert.equal(p.errors.length, 1);
});

/* ───────────── Real accounts, opening balances, earmarks ───────────── */
const OPAY = { id: 'acc_opay', opening: 500000 }, GTB = { id: 'acc_gtb', opening: 80000 };
const ALIASES = { pharma_cash: 'acc_opay', pharma_bank: 'acc_opay', pers_cash: 'acc_gtb', pers_bank: 'acc_gtb', coop: '', emergency: '', fixed_dep: '' };

test('opening balance is the balance at the start of the baseline date; earlier entries do not move it', () => {
  const txns = [
    { type: 'expense', amount: 9000, fromAcct: 'acc_opay', date: '2026-10-01' },   // before baseline: already inside opening
    { type: 'expense', amount: 2500, fromAcct: 'acc_opay', date: '2026-10-10' },   // on baseline date: counts
    { type: 'income', amount: 40000, toAcct: 'acc_opay', date: '2026-10-12' },
  ];
  const b = F.accountBalances([OPAY], txns, { baselineDate: '2026-10-10' });
  assert.equal(b.acc_opay, 500000 - 2500 + 40000);
});

test('legacy account names map only where the user said; "Not used" moves nothing', () => {
  const txns = [
    { type: 'expense', amount: 1000, fromAcct: 'pharma_bank', date: '2026-10-12' },          // → Opay
    { type: 'owner_withdrawal', amount: 5000, fromAcct: 'pharma_cash', toAcct: 'pers_cash', date: '2026-10-12' }, // Opay → GTB
    { type: 'transfer', amount: 700, fromAcct: 'pharma_cash', toAcct: 'pharma_bank', date: '2026-10-12' }, // both Opay → nets to 0
    { type: 'expense', amount: 333, fromAcct: 'coop', date: '2026-10-12' },                    // Not used → no effect
  ];
  const b = F.accountBalances([OPAY, GTB], txns, { baselineDate: '2026-10-10', aliases: ALIASES });
  assert.equal(b.acc_opay, 500000 - 1000 - 5000);
  assert.equal(b.acc_gtb, 80000 + 5000);
  assert.equal(b.acc_opay + b.acc_gtb, 580000 - 1000, 'internal moves never change the total');
});

test('earmark buckets sit inside an account and are never added to totals', () => {
  const bal = { acc_opay: 500000, acc_gtb: 80000 };
  const s = F.bucketSummary(bal, [{ label: 'Rent', parentId: 'acc_opay', amount: 150000 }, { label: 'Tax', parentId: 'acc_opay', amount: 50000 }]);
  assert.equal(s.acc_opay.earmarked, 200000);
  assert.equal(s.acc_opay.unearmarked, 300000);
  assert.equal(s.acc_opay.overEarmarked, false);
  assert.equal(Object.values(bal).reduce((a, b) => a + b, 0), 580000, 'total real money unchanged by earmarks');
  assert.equal(F.bucketSummary({ acc_gtb: 1000 }, [{ label: 'X', parentId: 'acc_gtb', amount: 5000 }]).acc_gtb.overEarmarked, true);
});

test('setup validation: blocks unsafe or ambiguous setups', () => {
  const gtb = { id: 'acc_gtb', label: 'GTBank', kind: 'bank', primary: false, opening: 80000 };
  const good = { baselineDate: '2026-10-10', accounts: [{ id: 'acc_opay', label: 'Opay', kind: 'wallet', primary: true, opening: 500000 }, gtb], buckets: [], aliases: ALIASES };
  assert.equal(F.validateSetup(good, [], TODAY).ok, true);
  const err = s => F.validateSetup({ ...good, ...s }, [], TODAY).errors.join(' | ');
  assert.match(err({ baselineDate: '2026-12-01' }), /future/);
  assert.match(err({ accounts: [{ ...good.accounts[0], opening: -5 }, gtb] }), /negative/);
  assert.match(err({ accounts: [{ ...good.accounts[0], opening: '' }, gtb] }), /opening balance/);
  assert.match(err({ accounts: [{ ...good.accounts[0], primary: false }, gtb] }), /exactly one/);
  assert.match(err({ accounts: [good.accounts[0], gtb, { id: 'b', label: 'opay', kind: 'bank', opening: 0 }] }), /Two accounts/);
  assert.match(err({ accounts: [good.accounts[0]] }), /no longer exists/);
  assert.match(err({ aliases: { ...ALIASES, pharma_bank: undefined } }), /Pharmacy Bank/);
  assert.match(err({ buckets: [{ label: 'Rent', parentId: 'nope', amount: 1 }] }), /inside one of your accounts/);
  const used = F.validateSetup(good, [{ type: 'expense', amount: 1, fromAcct: 'coop', date: '2026-10-01' }], TODAY);
  assert.equal(used.ok, true);
  assert.match(used.warnings.join(' '), /Coop Savings/);
  assert.match(used.info.join(' '), /before the baseline/);
});

/* ───────────── Financial integrity audit ───────────── */
test('cash-flow history uses recorded transactions only and reconciles to account movements', () => {
  const txns = [
    { type: 'loan_receipt', amount: 150000, toAcct: 'acc_opay', date: '2026-10-11' },
    { type: 'loan_repayment', amount: 55455, fromAcct: 'acc_opay', date: '2026-10-12', alloc: { principal: 37500, interest: 17955, fees: 0, unsplit: 0 } },
    { type: 'loan_repayment', amount: 20000, fromAcct: 'acc_opay', date: '2026-10-12', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 20000 } },
    { type: 'loan_repayment', amount: 99999, fromAcct: 'acc_opay', date: '2026-10-12', voided: true, alloc: { principal: 99999 } },
    { type: 'income', amount: 80000, cat: 'Pharmacy Sales', toAcct: 'acc_opay', date: '2026-10-13' },
    { type: 'expense', amount: 12000, cat: 'Food', fromAcct: 'acc_gtb', date: '2026-10-13' },
    { type: 'transfer', amount: 30000, fromAcct: 'acc_opay', toAcct: 'acc_gtb', date: '2026-10-13' },
    { type: 'owner_withdrawal', amount: 25000, fromAcct: 'acc_opay', toAcct: 'acc_gtb', date: '2026-10-13' },
    { type: 'capital_injection', fundingKind: 'gift', amount: 10000, toAcct: 'acc_gtb', date: '2026-10-14' },
  ];
  const cf = F.cashFlowSummary(txns, '2026-10-01', '2026-11-01');
  assert.equal(cf.opT, 80000 - 12000);
  assert.equal(cf.fin['Loan proceeds received'], 150000);
  assert.equal(cf.fin['Loan principal repaid'], -37500);
  assert.equal(cf.fin['Loan interest & fees paid'], -17955);
  assert.equal(cf.fin['Loan repayments (split pending)'], -20000);
  assert.equal(cf.fin['Capital / funding received'], 10000);
  assert.equal(cf.memo['Owner withdrawals'], 25000, 'shown as memo, not counted');
  const bal = F.accountBalances([{ id: 'acc_opay', opening: 0 }, { id: 'acc_gtb', opening: 0 }], txns);
  assert.equal(bal.acc_opay + bal.acc_gtb, cf.opT + cf.invT + cf.finT, 'statement total = change in real money');
});

test('integrity: full loan life-cycle keeps cash, liability and ledger consistent', () => {
  const inst = store('a1', F.buildSchedule(EASI_TERMS));
  const txns = [{ id: 1, type: 'loan_receipt', amount: 150000, toAcct: 'acc_opay', date: TODAY }];
  let allocs = [];
  const live = () => allocs.filter(a => !a.reversed);
  const pay = (id, amt, opts) => {
    const plan = F.allocatePayment(F.instalmentStates(inst, live(), TODAY), amt, opts || {});
    assert.equal(plan.ok, true, plan.error);
    txns.push({ id, type: 'loan_repayment', amount: amt, fromAcct: 'acc_opay', date: TODAY, alloc: plan.split });
    allocs = allocs.concat(allocRows('a1', id, plan));
  };
  const reverse = id => { txns.find(t => t.id === id).voided = true; allocs = allocs.map(a => a.txnId === id ? { ...a, reversed: true } : a); };
  pay(2, 30000);                       // partial
  reverse(2); pay(3, 35000);           // correction = reverse + one replacement
  pay(4, 55455, { mode: 'provisional' });
  pay(5, 10000, { mode: 'extra_principal' });
  const b = F.agreementBalances(EASI_TERMS, inst, allocs, txns, TODAY);
  const paidLive = txns.filter(t => t.type === 'loan_repayment' && !t.voided).reduce((s, t) => s + t.amount, 0);
  assert.equal(txns.filter(t => t.type === 'loan_repayment' && !t.voided).length, 3, 'correction leaves exactly one live entry');
  assert.equal(b.repaidToDate, paidLive);
  assert.equal(b.outstanding.total, 221820 - paidLive, 'liability = contract − live payments');
  const cash = F.accountBalances([{ id: 'acc_opay', opening: 0 }], txns).acc_opay;
  assert.equal(cash, 150000 - paidLive, 'cash moved once per live payment; schedules moved nothing');
  // Early settlement of the rest with the lender's figure.
  const plan = F.settlementPlan(F.instalmentStates(inst, live(), TODAY), 100000);
  assert.equal(Math.round((plan.outstanding - plan.waived) * 100) / 100, 100000);
  allocs = allocs.concat(allocRows('a1', 6, plan));
  const waived = inst.map(i => plan.waive.some(w => w.instalmentId === i.id) ? { ...i, waived: true } : i);
  const end = F.agreementBalances(EASI_TERMS, waived, allocs, txns, TODAY);
  assert.equal(end.outstanding.total, 0);
  assert.equal(end.settled, true);
});
