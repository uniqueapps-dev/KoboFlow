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

/* ───────────── Stage 0: one cash rule (cashPosition) ───────────── */
test('account access: cash, bank and wallet are available by default; coop, investment and anything else restricted', () => {
  for (const k of ['cash', 'bank', 'wallet']) assert.equal(F.accountAccess({ kind: k }), 'immediate', k);
  for (const k of ['coop', 'investment', 'savings', '', undefined]) assert.equal(F.accountAccess({ kind: k }), 'restricted', String(k));
  assert.equal(F.accountAccess({ kind: 'bank', access: 'restricted' }), 'restricted', 'a bank-type fixed deposit can be restricted');
  assert.equal(F.accountAccess({ kind: 'coop', access: 'immediate' }), 'immediate', 'a coop can be marked available');
  assert.equal(F.accountAccess({ kind: 'coop', access: 'bogus' }), 'restricted', 'unknown override values fall back to the default');
});

test('cash position: restricted money is excluded from available cash but kept in the total (net worth)', () => {
  const p = F.cashPosition([
    { id: 'w', label: 'Wallet', kind: 'wallet', balance: 100000 },
    { id: 'b', label: 'Bank', kind: 'bank', balance: 50000.5 },
    { id: 'c', label: 'Coop', kind: 'coop', balance: 80000 },
    { id: 'fd', label: 'Fixed deposit', kind: 'bank', access: 'restricted', balance: 200000 },
    { id: 'i', label: 'Investment', kind: 'investment', balance: 10000 },
  ], []);
  assert.equal(p.available, 150000.5);
  assert.equal(p.restricted, 290000);
  assert.equal(p.total, 440000.5);
  assert.equal(p.earmarked, 0);
  assert.equal(p.unearmarked, 150000.5);
  assert.deepEqual(p.overEarmarked, []);
});

test('cash position: earmarks are reported, never subtracted from balances; free money never goes negative per account', () => {
  const accounts = [
    { id: 'w', label: 'Wallet', kind: 'wallet', balance: 100000 },
    { id: 'b', label: 'Bank', kind: 'bank', balance: 20000 },
    { id: 'c', label: 'Coop', kind: 'coop', balance: 50000 },
  ];
  const p = F.cashPosition(accounts, [{ parentId: 'w', amount: 30000 }, { parentId: 'b', amount: 25000 }, { parentId: 'c', amount: 5000 }, { parentId: 'gone', amount: 999 }]);
  assert.equal(p.available, 120000, 'balances unchanged by earmarks');
  assert.equal(p.accounts.w.balance, 100000);
  assert.equal(p.earmarked, 55000, 'earmarks in available accounts');
  assert.equal(p.earmarkedRestricted, 5000, 'earmarks in restricted accounts reported separately');
  assert.equal(p.unearmarked, 70000, 'wallet 70,000 free; over-earmarked bank contributes 0, not −5,000');
  assert.deepEqual(p.overEarmarked, [{ id: 'b', label: 'Bank', balance: 20000, earmarked: 25000, shortBy: 5000 }]);
  assert.deepEqual(accounts.map(a => a.balance), [100000, 20000, 50000], 'inputs not modified');
});

test('cash position: opening balance is used when no current balance is given; empty input is all zeros', () => {
  assert.equal(F.cashPosition([{ id: 'w', kind: 'wallet', opening: 5000 }], []).available, 5000);
  assert.deepEqual(F.cashPosition([], null), { available: 0, restricted: 0, total: 0, earmarked: 0, earmarkedRestricted: 0, unearmarked: 0, overEarmarked: [], accounts: {} });
});

/* ───────────── Stage 0: spending runway history window ───────────── */
const spend = (date, amount, extra = {}) => ({ date, amount, type: 'expense', ...extra });
const MIXED = [
  spend('2026-10-01', 40000),
  { date: '2026-10-02', amount: 5500, type: 'loan_repayment', alloc: { principal: 5000, interest: 400, fees: 100 } },
  { date: '2026-10-03', amount: 20000, type: 'owner_withdrawal' },
  { date: '2026-10-04', amount: 15000, type: 'transfer' },
  { date: '2026-10-05', amount: 99000, type: 'income' },
  spend('2026-10-06', 7000, { voided: true }),
];

test('spending runway: no spending records in a long enough history is unavailable (no_spending), not 999', () => {
  const r = F.spendingRunway([{ date: '2026-10-01', amount: 50000, type: 'income' }], 500000, { today: TODAY, historyStart: '2026-06-01' });
  assert.equal(r.known, false);
  assert.equal(r.reason, 'no_spending');
  assert.equal(r.historyDays, 90);
  assert.equal(r.days, null);
  assert.equal(r.spending, 0);
  assert.equal(F.spendingRunway([], 500000, { today: TODAY, historyStart: '2026-06-01' }).reason, 'no_spending');
});

test('spending runway: under 30 days of history is unavailable (short_history), even with spending recorded', () => {
  const r = F.spendingRunway([spend('2026-10-14', 1000)], 1000000, { today: TODAY, historyStart: '2026-09-17' });
  assert.equal(r.historyDays, 29, '17 Sep to 15 Oct inclusive');
  assert.equal(r.known, false);
  assert.equal(r.reason, 'short_history');
  assert.equal(r.days, null, 'no optimistic number is produced');
  assert.equal(r.dailyBurn, null);
  assert.equal(r.monthlyBurn, null);
  // The old rule (÷ 90 days regardless of history) would have given 1,000,000 / (1,000 / 90) = 90,000 days.
  const s = F.spendingRunway([], 1000000, { today: TODAY, historyStart: TODAY });
  assert.deepEqual([s.historyDays, s.reason], [1, 'short_history'], 'baseline today: 1 day, short history takes precedence over no spending');
  assert.equal(F.spendingRunway([], 1, { today: TODAY }).reason, 'short_history', 'no history start: treated as starting today');
  assert.equal(F.spendingRunway([], 1, { today: TODAY, historyStart: '2026-12-01' }).historyDays, 1, 'a future start is clamped to today');
});

test('spending runway: exactly 30 days is enough; the average uses the real number of days, not 90', () => {
  const r = F.spendingRunway([spend('2026-09-16', 3000)], 300000, { today: TODAY, historyStart: '2026-09-16' });
  assert.equal(r.historyDays, 30);
  assert.equal(r.known, true);
  assert.equal(r.dailyBurn, 100, '3,000 / 30 days');
  assert.equal(r.days, 3000, '300,000 / 100');
});

test('spending runway: sufficient history, hand-calculated; expenses + interest/fees in, withdrawals, principal, transfers, income and voided out', () => {
  // History 1 Sep – 15 Oct inclusive = 45 days. Spending = 40,000 expense + 400 interest + 100 fees = 40,500.
  // Daily 40,500 / 45 = 900; monthly 900 × 30 = 27,000; runway 270,000 / 900 = 300 days.
  const r = F.spendingRunway(MIXED, 270000, { today: TODAY, historyStart: '2026-09-01' });
  assert.equal(r.historyDays, 45);
  assert.equal(r.windowStart, '2026-09-01');
  assert.equal(r.spending, 40500, 'not 60,500 (withdrawal) nor 45,500 (principal) nor 47,500 (voided)');
  assert.equal(r.dailyBurn, 900);
  assert.equal(r.monthlyBurn, 27000);
  assert.equal(r.days, 300);
  assert.equal(r.reason, null);
});

test('spending runway: complete history keeps the 90-day window; entries before it or after today are not used', () => {
  // Window 18 Jul – 15 Oct inclusive (90 days). In: 18 Jul 30,000 + 15 Oct 60,000 = 90,000 → 1,000/day.
  const txns = [spend('2026-07-17', 500000), spend('2026-07-18', 30000), spend('2026-10-15', 60000), spend('2026-10-16', 800000)];
  const r = F.spendingRunway(txns, 365000, { today: TODAY, historyStart: '2025-01-01' });
  assert.equal(r.historyDays, 90);
  assert.equal(r.windowStart, '2026-07-18');
  assert.equal(r.spending, 90000);
  assert.equal(r.dailyBurn, 1000);
  assert.equal(r.monthlyBurn, 30000);
  assert.equal(r.days, 365);
  assert.deepEqual(txns.map(t => t.amount), [500000, 30000, 60000, 800000], 'inputs not modified');
});

/* ───────────── Stage 0: cash cover (Pressure, Calendar, Autopilot, Opportunity) ───────────── */
test('cash cover: obligations are compared with free-to-use cash (after earmarks), each subtracted once', () => {
  const p = F.cashPosition([
    { id: 'w', label: 'Wallet', kind: 'wallet', balance: 100000 },
    { id: 'b', label: 'Bank', kind: 'bank', balance: 500000 },
    { id: 'c', label: 'Coop', kind: 'coop', balance: 80000 },
  ], [{ parentId: 'w', amount: 30000 }]);
  const c = F.cashCover(p, 55455);
  assert.equal(c.cashNow, 600000, 'gross Cash Now, for display');
  assert.equal(c.earmarked, 30000);
  assert.equal(c.freeToUse, 570000, 'Cash Now less earmarks; restricted coop not included');
  assert.equal(c.due, 55455);
  assert.equal(c.leftAfter, 514545, '570,000 − 55,455: earmark and obligation each subtracted once');
  assert.equal(c.pressure, 10, 'round(55,455 / 570,000 × 100)');
});

test('cash cover: shortfall is negative; no free cash gives full pressure only when something is due', () => {
  const p = F.cashPosition([{ id: 'w', kind: 'wallet', balance: 20000 }], [{ parentId: 'w', amount: 20000 }]);
  assert.deepEqual(F.cashCover(p, 5000), { cashNow: 20000, earmarked: 20000, freeToUse: 0, due: 5000, covered: 0, uncovered: 5000, leftAfter: -5000, pressure: 100 });
  assert.equal(F.cashCover(p, 0).pressure, 0, 'nothing due: no pressure');
  assert.equal(F.cashCover(F.cashPosition([{ id: 'w', kind: 'wallet', balance: 1000 }], []), 4000).pressure, 100, 'capped at 100');
  assert.equal(F.cashCover(F.cashPosition([{ id: 'w', kind: 'wallet', balance: 1000.10 }], []), 0.20).leftAfter, 999.9, 'kobo-exact');
});

/* ───────────── Integrated build: reservations linked to obligations ───────────── */
const RP_ACCTS = [
  { id: 'w', label: 'Wallet', kind: 'wallet', balance: 100000 },
  { id: 'b', label: 'Bank', kind: 'bank', balance: 500000 },
  { id: 'c', label: 'Coop', kind: 'coop', balance: 80000 },
];
const RP_OBLS = [
  { id: 'L_v1_1', agreementId: 'L', dueDate: '2026-10-25', remaining: 55455, label: 'Loan #1' },
  { id: 'L_v1_2', agreementId: 'L', dueDate: '2026-11-25', remaining: 55455, label: 'Loan #2' },
];

test('reservation linked to a loan covers its instalments by due date; general earmarks cover nothing', () => {
  const r = F.reservationPlan(RP_ACCTS, [
    { id: 'g', label: 'Rent', parentId: 'w', amount: 30000 },
    { id: 'l', label: 'Loan money', parentId: 'b', amount: 70000, reservedFor: 'agr:L' },
  ], RP_OBLS);
  assert.deepEqual(r.buckets.map(b => [b.id, b.status, b.effective, b.covers]), [['g', 'general', 30000, 0], ['l', 'linked', 70000, 70000]]);
  assert.deepEqual(r.coverage, { L_v1_1: 55455, L_v1_2: 14545 }, 'first instalment in full, then the next');
  // Cash cover for the 30-day window (instalment #1 only): it is fully covered, so nothing is subtracted twice.
  const p = F.cashPosition(RP_ACCTS, r.effective);
  assert.equal(p.unearmarked, 500000, '600,000 available − 30,000 − 70,000');
  const due30 = [RP_OBLS[0]];
  const c = F.cashCover(p, 55455, F.coveredAmount(due30, r.coverage));
  assert.deepEqual([c.covered, c.uncovered, c.leftAfter, c.pressure], [55455, 0, 500000, 0]);
  // Without the link the same money would be deducted as an earmark AND as the obligation.
  const unlinked = F.reservationPlan(RP_ACCTS, [{ id: 'l', label: 'Loan money', parentId: 'b', amount: 70000 }], RP_OBLS);
  const pu = F.cashPosition(RP_ACCTS, unlinked.effective);
  assert.equal(F.cashCover(pu, 55455, F.coveredAmount(due30, unlinked.coverage)).leftAfter, 474545, 'general earmark: obligation still subtracted');
});

test('reservation: partial funding leaves the uncovered part as a requirement; paid instalments stop being reserved', () => {
  const part = F.reservationPlan(RP_ACCTS, [{ id: 'l', label: 'Part', parentId: 'w', amount: 20000, reservedFor: 'agr:L' }], RP_OBLS);
  assert.equal(part.coverage.L_v1_1, 20000);
  const p = F.cashPosition(RP_ACCTS, part.effective);
  const c = F.cashCover(p, 55455, F.coveredAmount([RP_OBLS[0]], part.coverage));
  assert.deepEqual([c.freeToUse, c.covered, c.uncovered, c.leftAfter], [580000, 20000, 35455, 544545]);
  // After both instalments are paid there is nothing outstanding: the earmark reserves 0 and is reported as no longer needed.
  const paid = F.reservationPlan(RP_ACCTS, [{ id: 'l', label: 'Loan money', parentId: 'b', amount: 70000, reservedFor: 'agr:L' }], []);
  assert.deepEqual([paid.buckets[0].status, paid.buckets[0].effective], ['no_outstanding', 0]);
  assert.equal(F.cashPosition(RP_ACCTS, paid.effective).unearmarked, 600000, 'released once, automatically, without editing the earmark');
  // Partly paid: the reservation shrinks to what is still owed.
  const left = F.reservationPlan(RP_ACCTS, [{ id: 'l', label: 'Loan money', parentId: 'b', amount: 70000, reservedFor: 'agr:L' }], [{ ...RP_OBLS[0], remaining: 25000 }]);
  assert.equal(left.buckets[0].effective, 25000);
});

test('reservation: two earmarks for one loan share its outstanding amount; restricted or over-earmarked money covers nothing extra', () => {
  const two = F.reservationPlan(RP_ACCTS, [
    { id: 'a', label: 'A', parentId: 'b', amount: 100000, reservedFor: 'agr:L' },
    { id: 'z', label: 'Z', parentId: 'w', amount: 50000, reservedFor: 'agr:L' },
  ], RP_OBLS);
  assert.deepEqual(two.buckets.map(b => b.effective), [100000, 10910], 'total reserved never exceeds 110,910 owed');
  assert.equal(F.coveredAmount(RP_OBLS, two.coverage), 110910);
  const coop = F.reservationPlan(RP_ACCTS, [{ id: 'k', label: 'In coop', parentId: 'c', amount: 55455, reservedFor: 'agr:L' }], RP_OBLS);
  assert.deepEqual([coop.buckets[0].status, coop.buckets[0].covers], ['restricted_source', 0], 'restricted money is not available to pay');
  const over = F.reservationPlan([{ id: 'w', kind: 'wallet', balance: 30000 }], [
    { id: 'g', label: 'Rent', parentId: 'w', amount: 20000 },
    { id: 'l', label: 'Loan', parentId: 'w', amount: 55455, reservedFor: 'agr:L' },
  ], RP_OBLS);
  assert.deepEqual([over.buckets[1].funded, over.coverage.L_v1_1], [10000, 10000], 'only money the account holds covers the obligation');
  assert.equal(F.cashPosition([{ id: 'w', kind: 'wallet', balance: 30000 }], over.effective).overEarmarked[0].shortBy, 45455);
});

test('data quality: flags records that distort figures without changing them', () => {
  const txns = [
    { id: 1, date: '2026-10-10', amount: 500, type: 'expense', desc: 'Fuel', state: 'Needs Review', fromAcct: 'w' },
    { id: 2, date: '2026-10-20', amount: 100, type: 'expense', desc: 'Later', state: 'Linked', fromAcct: 'w' },
    { id: 3, date: '2026-10-11', amount: 900, type: 'income', desc: 'Sales', state: 'Linked', toAcct: 'pharma_cash' },
    { id: 4, date: '2026-10-11', amount: 900, type: 'income', desc: 'sales ', state: 'Linked', toAcct: 'pharma_cash' },
    { id: 5, date: '2026-10-12', amount: 300, type: 'income', desc: 'No account', state: 'Linked', toAcct: '' },
    { id: 6, date: '2026-09-01', amount: 300, type: 'expense', desc: 'Old', state: 'Linked', fromAcct: 'w' },
    { id: 7, date: '2026-10-10', amount: 500, type: 'expense', desc: 'Fuel', state: 'Needs Review', fromAcct: 'w', voided: true },
  ];
  const q = F.dataQuality({ txns, accountIds: ['w'], aliases: { pharma_cash: '' }, baselineDate: '2026-10-01', today: TODAY });
  const by = Object.fromEntries(q.map(x => [x.key, x]));
  assert.deepEqual(by.needs_review.ids, [1], 'voided entries are ignored');
  assert.deepEqual(by.future_dated.ids, [2]);
  assert.deepEqual(by.unmapped_account.ids, [3, 4], '"Not used" mapping moves no balance');
  assert.deepEqual(by.missing_account.ids, [5]);
  assert.deepEqual(by.possible_duplicates.ids, [4]);
  assert.deepEqual(by.pre_baseline.ids, [6]);
  assert.equal(by.pre_baseline.severity, 'info');
  assert.deepEqual(txns.map(t => t.id), [1, 2, 3, 4, 5, 6, 7], 'input untouched');
});

test('budgets: only configured budgets; expenses in the month, voided and other categories excluded', () => {
  const r = F.budgetProgress([{ id: 'b1', cat: 'Food', amount: 20000 }], [
    { date: '2026-10-02', amount: 5000, type: 'expense', cat: 'Food' },
    { date: '2026-10-03', amount: 2500, type: 'obligation', cat: 'Food' },
    { date: '2026-10-04', amount: 9000, type: 'expense', cat: 'Food', voided: true },
    { date: '2026-09-30', amount: 9000, type: 'expense', cat: 'Food' },
    { date: '2026-10-04', amount: 9000, type: 'expense', cat: 'Household' },
    { date: '2026-10-05', amount: 9000, type: 'owner_withdrawal', cat: 'Food' },
  ], '2026-10-01', TODAY);
  assert.deepEqual(r, [{ id: 'b1', cat: 'Food', amount: 20000, used: 7500, left: 12500, pct: 38 }]);
  assert.deepEqual(F.budgetProgress([], [], '2026-10-01', TODAY), []);
});

test('setup validation: planning targets and budgets are optional but must be sensible; links must be recognisable', () => {
  const base = { baselineDate: '2026-10-01', accounts: [{ id: 'w', label: 'W', kind: 'wallet', opening: 0, primary: true }], buckets: [],
    aliases: Object.fromEntries(Object.keys(F.LEGACY_ACCOUNTS).map(k => [k, 'w'])) };
  assert.equal(F.validateSetup({ ...base, planning: {}, budgets: [] }, [], TODAY).ok, true, 'nothing set is valid');
  assert.equal(F.validateSetup({ ...base, planning: { workingCapitalFloor: '', netWorthGoal: null } }, [], TODAY).ok, true);
  const bad = F.validateSetup({ ...base, planning: { workingCapitalFloor: -5, netWorthGoal: 0 },
    budgets: [{ cat: 'Food', amount: 100 }, { cat: 'Food', amount: 0 }, { cat: '', amount: 5 }],
    buckets: [{ id: 'x', label: 'X', parentId: 'w', amount: 1, reservedFor: 'something' }] }, [], TODAY);
  assert.deepEqual(bad.errors, [
    'Earmark "X" is linked to something KoboFlow does not recognise. Choose what it is for again.',
    'The working-capital floor must be more than 0, or left blank.',
    'The net-worth goal must be more than 0, or left blank.',
    'There are two budgets for "Food".',
    'The budget for "Food" needs a monthly amount above 0.',
    'Budget 3 needs a category.',
  ]);
});

/* ───────────── Daily Money Director ───────────── */
const dir = (over = {}) => F.directorPlan({ today: TODAY, cashNow: 600000, restricted: 80000, earmarkedGeneral: 30000, reservedLinked: 0,
  freeToUse: 570000, obligations: [], floor: 200000, quality: [], overEarmarked: [], staleReservations: [], ...over });

test('director: arithmetic reconciles and the free amount respects commitments and the working-capital floor; no percentage split', () => {
  const r = dir({ obligations: [{ id: 'a', label: 'Loan #1', dueDate: '2026-10-20', remaining: 55455, covered: 20000 }] });
  const f = r.figures;
  assert.deepEqual([f.due, f.covered, f.uncovered, f.freeAfterCommitments, f.floor, f.safeToAllocate], [55455, 20000, 35455, 534545, 200000, 334545]);
  assert.equal(f.freeToUse - f.uncovered, f.freeAfterCommitments);
  assert.equal(f.freeAfterCommitments - f.floor, f.safeToAllocate);
  assert.deepEqual(r.obligations[0].funding, 'partly');
  assert.deepEqual(r.actions.map(a => a.kind), ['due_soon', 'free']);
  assert.match(r.actions[0].title, /Set aside ₦35,455 for Loan #1 due 2026-10-20/);
  assert.match(r.actions[1].title, /₦334,545 can go to other purposes/);
  assert.equal(r.actions.some(a => /%/.test(a.title + a.why + a.consequence)), false, 'no generic percentages');
  assert.equal(r.qualified, false);
});

test('director: ranking puts overdue first, then shortfall, then due soon, then reserve; floor breach and data issues follow', () => {
  const r = dir({ freeToUse: 60000, floor: 100000, obligations: [
    { id: 'c', label: 'Later', dueDate: '2026-11-10', remaining: 40000, covered: 0 },
    { id: 'a', label: 'Late', dueDate: '2026-10-10', remaining: 30000, covered: 0 },
    { id: 'b', label: 'Soon', dueDate: '2026-10-18', remaining: 30000, covered: 30000 },
    { id: 'd', label: 'Week', dueDate: '2026-10-19', remaining: 25000, covered: 0 },
  ], quality: [{ key: 'needs_review', severity: 'high', text: '2 entries need review.' }, { key: 'pre_baseline', severity: 'info', text: 'x' }] });
  assert.deepEqual(r.actions.map(a => a.kind), ['overdue', 'shortfall', 'due_soon', 'reserve', 'floor_breach', 'data_quality']);
  assert.deepEqual(r.actions.map(a => a.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.figures.uncovered, 95000, 'the funded instalment needs nothing more');
  assert.equal(r.figures.freeAfterCommitments, -35000);
  assert.equal(r.figures.safeToAllocate, 0, 'never a positive amount to allocate during a shortfall');
  assert.match(r.actions[1].why, /first payment that cannot be met in full is Later on 2026-11-10/);
  assert.equal(r.obligations.find(o => o.id === 'b').funding, 'funded');
  assert.equal(r.actions.some(a => a.kind === 'free'), false);
  assert.equal(r.qualified, true, 'high-severity data issues qualify the result');
});

test('director: no floor set is said plainly; stale reservations and over-earmarks are actions, not silent corrections', () => {
  const r = dir({ floor: null, obligations: [], overEarmarked: [{ label: 'Opay', shortBy: 5000 }], staleReservations: [{ label: 'Old loan' }] });
  assert.deepEqual(r.actions.map(a => a.kind), ['over_earmark', 'stale_reservation', 'set_floor', 'free']);
  assert.equal(r.figures.floor, null);
  assert.equal(r.figures.safeToAllocate, 570000);
  assert.match(r.actions[3].why, /No working-capital floor is set/);
  assert.equal(r.qualified, true);
});

test('cash position: a negative (overdrawn) balance reduces free-to-use cash; over-earmarking alone never does', () => {
  const p = F.cashPosition([
    { id: 'w', label: 'Wallet', kind: 'wallet', balance: 250000 },
    { id: 'b', label: 'Bank', kind: 'bank', balance: -80000 },
  ], [{ parentId: 'w', amount: 30000 }, { parentId: 'b', amount: 10000 }]);
  assert.equal(p.available, 170000);
  assert.equal(p.unearmarked, 140000, '220,000 from the wallet, −80,000 from the overdrawn bank');
  assert.ok(p.unearmarked <= p.available, 'free-to-use never exceeds Cash Now');
});

/* ───────────── Bills (database v4): recurrence, payments, reservations ───────────── */
const BILL = (over = {}) => ({ id: 'b_rent', name: 'Shop rent', cat: 'Business Overhead', amount: 50000, firstDue: '2026-10-20', repeat: 'monthly', status: 'active', amountChanges: [], overrides: {}, ...over });
const payTx = (over = {}) => ({ id: 1, type: 'obligation', amount: 20000, date: '2026-10-15', fromAcct: 'b', billId: 'b_rent', billOcc: 'b_rent@2026-10-20', ...over });

test('bill dates: month-end anchored, leap years, weekly, quarterly, one-time and an end date', () => {
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2026-01-31' }), '2026-05-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2028-01-31' }), '2028-03-01'), ['2028-01-31', '2028-02-29']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2028-02-29', repeat: 'yearly' }), '2030-12-31'), ['2028-02-29', '2029-02-28', '2030-02-28']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2026-10-01', repeat: 'weekly' }), '2026-10-22'), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2026-11-30', repeat: 'quarterly' }), '2027-06-30'), ['2026-11-30', '2027-02-28', '2027-05-30']);
  assert.deepEqual(F.billDueDates(BILL({ repeat: 'none' }), '2030-01-01'), ['2026-10-20']);
  assert.deepEqual(F.billDueDates(BILL({ until: '2026-12-01' }), '2027-12-31'), ['2026-10-20', '2026-11-20']);
});

test('bill occurrences: stable ids, partial and full payment, overdue, voided payments ignored, deterministic on reload', () => {
  const b = BILL({ firstDue: '2026-09-20' });
  const txns = [payTx({ billOcc: 'b_rent@2026-10-20' }), payTx({ id: 2, amount: 50000, billOcc: 'b_rent@2026-09-20', date: '2026-09-20' }), payTx({ id: 3, amount: 30000, voided: true })];
  const occ = F.billOccurrences(b, txns, { today: TODAY, until: '2026-11-30' });
  assert.deepEqual(occ.map(o => [o.id, o.status, o.paid, o.remaining]), [
    ['b_rent@2026-09-20', 'paid', 50000, 0],
    ['b_rent@2026-10-20', 'partial', 20000, 30000],
    ['b_rent@2026-11-20', 'upcoming', 0, 50000],
  ]);
  assert.deepEqual(F.billOccurrences(b, txns, { today: TODAY, until: '2026-11-30' }), occ, 'same records, same occurrences: nothing generated twice');
  const missed = F.billOccurrences(BILL({ firstDue: '2026-08-20' }), [], { today: TODAY, until: '2026-10-31' });
  assert.deepEqual(missed.map(o => o.status), ['overdue', 'overdue', 'due_soon'], 'missed months stay owed');
  assert.equal(F.billOccurrences(BILL({ firstDue: TODAY }), [], { today: TODAY })[0].status, 'due_today');
});

test('bill occurrences: an amount change applies from its date; cancelling and "not owed" stop only what they should', () => {
  const b = BILL({ firstDue: '2026-09-20', amountChanges: [{ from: '2026-11-01', amount: 60000 }] });
  assert.deepEqual(F.billOccurrences(b, [], { today: TODAY, until: '2026-12-31' }).map(o => o.amount), [50000, 50000, 60000, 60000], 'earlier occurrences keep their amount');
  const c = BILL({ firstDue: '2026-09-20', status: 'cancelled', cancelledFrom: TODAY });
  assert.deepEqual(F.billOccurrences(c, [], { today: TODAY, until: '2026-12-31' }).map(o => [o.dueDate, o.status, o.remaining]),
    [['2026-09-20', 'overdue', 50000], ['2026-10-20', 'cancelled', 0], ['2026-11-20', 'cancelled', 0], ['2026-12-20', 'cancelled', 0]], 'an unpaid past occurrence stays owed');
  const sk = BILL({ firstDue: '2026-09-20', overrides: { '2026-09-20': { skipped: true, reason: 'waived' } } });
  assert.deepEqual(F.billOccurrences(sk, [], { today: TODAY, until: '2026-10-31' }).map(o => o.status), ['skipped', 'due_soon']);
  assert.deepEqual(F.billObligations([c, sk], [], { today: TODAY, until: '2026-10-31' }).map(o => [o.id, o.target, o.remaining]), [['b_rent@2026-09-20', 'bill:b_rent', 50000], ['b_rent@2026-10-20', 'bill:b_rent', 50000]]);
});

test('bill validation; a bill with payments keeps its schedule; payments to a vanished date are reported', () => {
  assert.deepEqual(F.validateBill({ name: '', amount: 0, firstDue: '', repeat: 'daily' }).errors, ['Give the bill a name.', 'Enter the amount (more than 0).', 'Choose the first due date.', 'Choose how often it repeats.']);
  assert.equal(F.validateBill(BILL()).ok, true);
  assert.match(F.validateBill(BILL({ firstDue: '2026-10-21' }), { previous: BILL(), hasPayments: true }).errors[0], /already has payments/);
  assert.equal(F.validateBill(BILL({ name: 'Rent (shop)' }), { previous: BILL(), hasPayments: true }).ok, true);
  assert.deepEqual(F.billUnmatchedPayments([BILL()], [payTx({ billOcc: 'b_rent@2026-10-21' }), payTx({ id: 2 })], { today: TODAY }).map(t => t.id), [1]);
});

test('reservations cover bills and loans with one model: one naira is never counted twice; restricted money covers nothing', () => {
  const accts = [{ id: 'w', label: 'Wallet', kind: 'wallet', balance: 100000 }, { id: 'c', label: 'Coop', kind: 'coop', balance: 80000 }];
  const obls = F.billObligations([BILL({ firstDue: '2026-10-20' })], [payTx()], { today: TODAY, until: '2026-11-30' })
    .concat([{ id: 'L_1', agreementId: 'L', dueDate: '2026-10-25', remaining: 10000 }]);
  const r = F.reservationPlan(accts, [
    { id: 'rb', label: 'Rent money', parentId: 'w', amount: 40000, reservedFor: 'bill:b_rent' },
    { id: 'rl', label: 'Loan money', parentId: 'w', amount: 10000, reservedFor: 'agr:L' },
    { id: 'rc', label: 'Rent in coop', parentId: 'c', amount: 50000, reservedFor: 'bill:b_rent' },
  ], obls);
  assert.deepEqual(r.coverage, { 'b_rent@2026-10-20': 30000, 'b_rent@2026-11-20': 10000, L_1: 10000 }, 'the part-paid occurrence needs only 30,000');
  assert.equal(r.buckets[2].status, 'restricted_source');
  const due30 = obls.filter(o => o.dueDate <= '2026-11-14');
  const p = F.cashPosition(accts, r.effective);
  const c = F.cashCover(p, due30.reduce((t, o) => t + o.remaining, 0), F.coveredAmount(due30, r.coverage));
  assert.deepEqual([p.available, p.unearmarked, c.due, c.covered, c.uncovered, c.leftAfter], [100000, 50000, 40000, 40000, 0, 50000]);
  assert.equal(p.available - (40000 + 10000) - c.uncovered, c.leftAfter, 'reconciles: Cash Now − linked earmarks − uncovered = free after commitments');
  const paidAll = F.billObligations([BILL({ firstDue: '2026-10-20', repeat: 'none' })], [payTx({ amount: 50000 })], { today: TODAY });
  assert.deepEqual(paidAll, [], 'a paid bill is no longer an obligation');
});

test('opportunity analysis applies the working-capital floor once, before and after the commitment; no floor is qualified', () => {
  const o = { ...EASI_OPP, expectedProfit: 160000, conversionDays: 150, recovery: 'end' };
  const base = F.analyzeOpportunity(o, { freeCash: 300000 });
  assert.equal(base.floor, undefined, 'no floor passed: older callers unchanged');
  assert.ok(base.maxShortfall > 0);
  const above = F.analyzeOpportunity(o, { freeCash: 300000, floor: 50000 });
  assert.equal(above.verdict, base.verdict);
  assert.deepEqual(above.before, { freeAfterCommitments: 300000, aboveFloor: 250000 });
  assert.equal(above.after.lowestFree, Math.round((300000 - above.maxShortfall) * 100) / 100);
  assert.ok(above.after.aboveFloor >= 0);
  const below = F.analyzeOpportunity(o, { freeCash: 300000, floor: 200000 });
  assert.equal(below.verdict, 'bad');
  assert.match(below.reasons.join(' '), /below your working-capital floor of ₦200,000/);
  const none = F.analyzeOpportunity(o, { freeCash: 300000, floor: null });
  assert.equal(none.floor, null);
  assert.match(none.reasons.join(' '), /No working-capital floor is set/);
  assert.equal(none.before.aboveFloor, null);
  const already = F.analyzeOpportunity(o, { freeCash: 40000, floor: 50000 });
  assert.match(already.reasons.join(' '), /Even before this commitment/);
  assert.ok(!('income' in above), 'loan proceeds are never treated as income');
});

test('bill dates: a 29th or 30th due day clamps in short months and returns in long ones, leap years included', () => {
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2027-01-29' }), '2027-04-30'), ['2027-01-29', '2027-02-28', '2027-03-29', '2027-04-29']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2028-01-29' }), '2028-03-31'), ['2028-01-29', '2028-02-29', '2028-03-29']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2027-01-30' }), '2027-05-31'), ['2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30', '2027-05-30']);
  assert.deepEqual(F.billDueDates(BILL({ firstDue: '2026-12-31' }), '2027-02-28'), ['2026-12-31', '2027-01-31', '2027-02-28'], 'across a year end');
});

test('reservations never exceed what is still owed, whatever is paid; nothing is released twice', () => {
  const accts = [{ id: 'w', kind: 'wallet', balance: 1000000 }];
  const bk = [{ id: 'a', parentId: 'w', amount: 80000, reservedFor: 'bill:b_rent' }, { id: 'z', parentId: 'w', amount: 80000, reservedFor: 'bill:b_rent' }];
  for (const paid of [0, 10000, 49999, 50000, 90000, 100000, 150000]) {
    // Three monthly dates of 50,000; payments applied to the earliest dates first.
    const txns = []; let left = paid;
    for (const d of ['2026-10-20', '2026-11-20', '2026-12-20']) { const a = Math.min(50000, left); left -= a; if (a > 0) txns.push(payTx({ id: txns.length + 1, amount: a, billOcc: 'b_rent@' + d })); }
    const obls = F.billObligations([BILL()], txns, { today: TODAY, until: '2026-12-31' });
    const owed = obls.reduce((t, o) => t + o.remaining, 0);
    const r = F.reservationPlan(accts, bk, obls);
    const reserved = r.buckets.reduce((t, b) => t + b.effective, 0);
    assert.equal(reserved, Math.min(160000, owed), `paid ${paid}: reserved ${reserved} vs owed ${owed}`);
    assert.equal(F.coveredAmount(obls, r.coverage), Math.min(160000, owed));
    assert.equal(F.cashPosition(accts, r.effective).unearmarked, 1000000 - reserved, 'each naira reserved once');
  }
});

test('opportunity analysis counts your other known payments due during the repayment period (their unreserved part)', () => {
  const o = { ...EASI_OPP, expectedProfit: 160000, conversionDays: 150, recovery: 'end' };
  const alone = F.analyzeOpportunity(o, { freeCash: 300000, floor: 50000 });
  assert.equal(alone.otherPaymentsInPeriod, 0);
  // A 60,000 bill due before the second repayment, and one due after the last repayment (not in the period).
  const firstDue = EASI_OPP.firstDueDate;
  const withOther = F.analyzeOpportunity(o, { freeCash: 300000, floor: 50000, laterObligations: [{ dueDate: F.addDays(firstDue, 20), amount: 60000 }, { dueDate: '2030-01-01', amount: 999999 }] });
  assert.equal(withOther.otherPaymentsInPeriod, 60000);
  assert.equal(withOther.after.lowestFree, Math.round((300000 - alone.maxShortfall - 60000) * 100) / 100);
  assert.equal(withOther.before.freeAfterCommitments, 300000, 'the before figure is unchanged (same as the Director)');
  const tight = F.analyzeOpportunity(o, { freeCash: alone.maxShortfall + 30000, floor: null, laterObligations: [{ dueDate: F.addDays(firstDue, 20), amount: 60000 }] });
  assert.equal(tight.verdict, 'bad', 'affordable alone, not with the other payments');
  assert.match(tight.reasons.join(' '), /other known payments of ₦60,000 also fall due in that period/);
});
