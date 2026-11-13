// STAGE 1 — the central classification engine (scopeOf), the read-only obligation router and the
// measures table (docs/personal-money-separation-design.md, sections 5, 6, 12.1 and stage 1 of 23).
// Engine tests: the 5.2 and 5.3 truth tables, the kobo partition invariant, Examples A, B, C and 15,
// a hand-calculated fixture for every measures-table figure, the router, historical and incomplete
// records, no mutation, and consistency with the existing calculations where Stage 1 must not change
// anything. Browser tests (TEST build and production candidate): the read-only summary shows exactly
// the engine's parts for every entry, and every other screen's text is identical to the accepted
// Stage 0 build (3359ae0); demo mode shows no card. Fictional data only; disposable browser profiles.
// Stage 1 completion (owner-approved implementation plan, decisions Q1–Q10): financing, external
// funding and the agreement-checked owner contribution (P-D2, N1, N3a, N3b), loan repayment components
// and provisional repayments (P-D11, P-D11b, P-D11e), separate Business / Shared / other figures with
// pre-opening parts (P-D10, R-open), the three income measures (P-D13, P-D13b, Q-N2), the payer warnings
// and shared_payer (P-D6), the two review figures (P-D15) and the summary totals (P-D3). Superseded
// assertions are rewritten to the approved decision, which is named beside each change.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const F = require('./load-engine')();
const { stage2Texts } = require('./stage2-regions');

const ROOT = path.join(__dirname, '..');
let pw = null;
for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(t); break; } catch (e) { /* next */ } }
const skip = !pw && 'Playwright not installed';
const OUTSIDE = F.OUTSIDE;

/* ── Fixture accounts (fictional) ───────────────────────────── */
const CONF = '2026-10-01T09:00:00.000Z';
const acct = (id, use, o = {}) => ({ id, label: 'Fictional ' + id, kind: 'bank', opening: 0, use, useConfirmedAt: use ? CONF : null, useConfirmedValue: use || null, ...o });
const ACCTS = [
  acct('opay', 'business', { kind: 'wallet', opening: 400000 }),
  acct('tb', 'business', { opening: 100000 }),
  acct('pb', 'personal', { opening: 40000 }),
  acct('ps', 'personal', { kind: 'coop', opening: 0 }),
  acct('sh', 'shared', { opening: 300000, sharedPortion: { amount: 100000, declaredAt: '2026-10-01' } }),
  acct('un', 'business', { kind: 'wallet', opening: 50000, useConfirmedAt: null, useConfirmedValue: null }),   // Business, never confirmed
  acct('stale', 'personal', { opening: 0, useConfirmedValue: 'business' }),                                    // confirmation no longer matches
  acct('nc', '', { kind: 'wallet', opening: 10000 }),                                                          // Used For not chosen
];
const ALIASES = { pharma_cash: 'opay', pharma_bank: 'tb', pers_cash: OUTSIDE, pers_bank: '', coop: '', emergency: '', fixed_dep: '' };
const CTX = F.scopeContext(ACCTS, { aliases: ALIASES });
let nid = 1;
const e = (o) => ({ id: nid++, type: 'expense', amount: 1000, desc: 'Fictional', cat: 'Other', date: '2026-11-10', time: '09:00', fromAcct: '', toAcct: '', state: 'Manual', ...o });
const K = n => Math.round(n * 100);
const sumParts = s => s.parts.pharmacy + s.parts.personal + s.parts.unclassified;

/* ── 5.2 truth table: one payer ─────────────────────────────── */
const PAYERS = {
  business: { acct: 'opay', pos: 'pharmacy', ownership: 'business' },
  legacyBusiness: { acct: 'pharma_cash', pos: 'pharmacy', ownership: 'business' },
  personal: { acct: 'pb', pos: 'personal', ownership: 'personal' },
  shared: { acct: 'sh', pos: null, ownership: 'shared', flag: 'shared_needs_purpose' },
  unconfirmed: { acct: 'un', pos: null, ownership: 'unconfirmed', flag: 'unconfirmed_account' },
  staleConfirmation: { acct: 'stale', pos: null, ownership: 'unconfirmed', flag: 'unconfirmed_account' },
  notChosen: { acct: 'nc', pos: null, ownership: 'unconfirmed', flag: 'unconfirmed_account' },
  outsideRaw: { acct: OUTSIDE, pos: null, status: 'outside', flag: 'outside_needs_purpose' },
  outsideMapped: { acct: 'pers_cash', pos: null, status: 'outside', flag: 'outside_needs_purpose' },
  unresolvedNotUsed: { acct: 'pers_bank', pos: null, status: 'unresolved', flag: 'unresolved_source' },
  unresolvedRemoved: { acct: 'acc_gone', pos: null, status: 'unresolved', flag: 'unresolved_source' },
  missing: { acct: '', pos: null, status: 'none', flag: 'missing_source' },
};
// Loan receipts and loan repayment entries are not classified by 5.2 (5.2 heading; P-D2, P-D11): they
// were in this table before the Stage 1 completion and are now tested by their own rules below.
const SINGLE = { expense: 'from', obligation: 'from', income: 'to' };
// Expected result by the design's precedence (5.2), written out case by case, for spending (the paying
// account) and for income (the receiving account).
function expected52(type, payer, purpose, split) {
  const P = PAYERS[payer], income = type === 'income';
  // P-D13c (owner-approved revision of P-D13b; I-2): income with no receiving account follows the general
  // rules below — a valid split or an explicit purpose classifies it, with its missing_source warning kept;
  // otherwise it is unresolved. (Previously this line returned unresolved for every such case, whatever
  // its split or purpose.)
  if (split === 'valid') return { kind: 'shared', basis: 'explicit_split' };
  if (split === 'bad') return { kind: 'unclassified', basis: 'none', flag: 'split_does_not_reconcile' };
  // P-D13 / Q-13, 5.2 rule 3: Shared-account income needs a valid split; rule 2 does not apply.
  if (income && P.ownership === 'shared') return { kind: 'unclassified', basis: 'none', flag: 'shared_needs_purpose' };
  if (purpose === 'pharmacy' || purpose === 'personal') {
    if (P.pos && P.pos !== purpose) {
      // Q-N2 / N2: income whose purpose differs from the confirmed receiving account is unresolved income
      // (previously asserted as cross-boundary here, which made it an owner withdrawal or contribution).
      if (income) return { kind: 'unclassified', basis: 'none', flag: 'purpose_differs_from_payer' };
      return { kind: purpose === 'personal' ? 'cross_pharmacy_paid_personal' : 'cross_personal_paid_pharmacy', basis: 'explicit_purpose', flag: 'purpose_differs_from_payer' };
    }
    // P-D6: a Shared paying account → shared_payer; no confirmed ownership → that side's warning is kept
    // (previously no flag was asserted). P-D13b: the same for a known receiving account.
    if (P.ownership === 'shared') return { kind: purpose, basis: 'explicit_purpose', flag: 'shared_payer' };
    return { kind: purpose, basis: 'explicit_purpose', flag: P.flag };
  }
  if (purpose === 'shared') return { kind: 'unclassified', basis: 'none', flag: 'shared_needs_purpose' };
  if (purpose === 'unclassified') return { kind: 'unclassified', basis: 'none', noShared: true }; // Q8: no shared_payer
  if (P.pos) return { kind: P.pos, basis: 'account_ownership' };
  return { kind: 'unclassified', basis: 'none', flag: P.flag };
}
test('5.2 truth table: every income, expense and obligation entry × payer state × purpose × split gives the design\'s kind, basis and flag, with an exact partition', () => {
  let n = 0;
  for (const [type, side] of Object.entries(SINGLE)) for (const payer of Object.keys(PAYERS)) for (const purpose of [undefined, 'pharmacy', 'personal', 'shared', 'unclassified']) for (const split of [undefined, 'valid', 'bad']) {
    const amount = 20000.01;
    const t = e({ type, amount, [side === 'from' ? 'fromAcct' : 'toAcct']: PAYERS[payer].acct });
    if (purpose !== undefined) t.purpose = purpose;
    if (split === 'valid') t.split = { pharmacy: 12000.01, personal: 8000, method: 'amount' };
    if (split === 'bad') t.split = { pharmacy: 12000, personal: 8000, method: 'amount' }; // one kobo short
    const s = F.scopeOf(t, CTX), x = expected52(type, payer, purpose, split), label = `${type}/${payer}/${purpose}/${split}`;
    assert.equal(s.kind, x.kind, label); assert.equal(s.basis, x.basis, label);
    if (x.flag) assert.ok(s.flags.includes(x.flag), `${label}: flag ${x.flag} in ${s.flags}`);
    if (x.flag !== 'shared_payer') assert.ok(!s.flags.includes('shared_payer'), `${label}: no shared_payer`);
    if (type === 'income') assert.ok(!/^(cross_|owner_)/.test(s.kind), `${label}: income is never cross-boundary, a withdrawal or a contribution (N2)`);
    if (type === 'income' && payer === 'missing') assert.ok(s.flags.includes('missing_source'), `${label}: P-D13c keeps the missing_source warning in every case`);
    assert.equal(sumParts(s), K(amount), `${label}: partition equals the amount in kobo`);
    assert.ok(F.SCOPE_KINDS.includes(s.kind));
    if (s.kind === 'unclassified') assert.deepEqual(s.parts, { pharmacy: 0, personal: 0, unclassified: K(amount) }, label);
    if (split === 'valid' && x.kind === 'shared') assert.deepEqual(s.parts, { pharmacy: K(12000.01), personal: K(8000), unclassified: 0 }, label);
    assert.equal(s.payer.side, side, label);
    if (PAYERS[payer].ownership) assert.equal(s.payer.ownership, PAYERS[payer].ownership, label);
    if (PAYERS[payer].status) assert.equal(s.payer.status, PAYERS[payer].status, label);
    n++;
  }
  assert.equal(n, 3 * 12 * 5 * 3);
});

test('5.2 rule 4: vehicle defaults — used alone, agreeing, or giving no default when they disagree with the payer (Q4); Shared or Unclassified vehicle purposes give none', () => {
  const ctx = (vp) => F.scopeContext(ACCTS, { aliases: ALIASES, vehiclePurposes: vp });
  const cases = [
    [{ fromAcct: 'opay', vehicle: 'green' }, { green: 'pharmacy' }, 'pharmacy', 'account_ownership', null],
    [{ fromAcct: 'opay', vehicle: 'green' }, { green: 'personal' }, 'unclassified', 'none', 'defaults_disagree'],
    [{ fromAcct: 'pb', vehicle: 'green' }, { green: 'pharmacy' }, 'unclassified', 'none', 'defaults_disagree'],
    [{ fromAcct: OUTSIDE, vehicle: 'green' }, { green: 'personal' }, 'personal', 'vehicle_default', 'outside_needs_purpose'],
    [{ fromAcct: 'un', vehicle: 'green' }, { green: 'pharmacy' }, 'pharmacy', 'vehicle_default', 'unconfirmed_account'],
    [{ fromAcct: '', vehicle: 'green' }, { green: 'shared' }, 'unclassified', 'none', 'missing_source'],
    [{ fromAcct: OUTSIDE, vehicle: 'green' }, { green: 'unclassified' }, 'unclassified', 'none', 'outside_needs_purpose'],
    [{ fromAcct: 'sh', vehicle: 'green' }, { green: 'pharmacy' }, 'unclassified', 'none', 'shared_needs_purpose'],   // rule 3 before rule 4
    [{ fromAcct: 'opay', vehicle: 'green' }, {}, 'pharmacy', 'account_ownership', null],                                 // Stage 1 app: no vehicle purposes stored
  ];
  for (const [o, vp, kind, basis, flag] of cases) {
    const s = F.scopeOf(e({ amount: 15000, ...o }), ctx(vp));
    assert.equal(s.kind, kind, JSON.stringify([o, vp])); assert.equal(s.basis, basis, JSON.stringify([o, vp]));
    if (flag) assert.ok(s.flags.includes(flag), JSON.stringify([o, vp, s.flags]));
  }
});

/* ── 5.3 truth table: two-sided movements ───────────────────── */
const SIDES = { business: 'opay', business2: 'tb', personal: 'pb', personal2: 'ps', shared: 'sh', unconfirmed: 'un', notChosen: 'nc', outside: OUTSIDE, unresolved: 'pers_bank', missing: '' };
function expected53(a, b, type) {
  // An empty side: owner_withdrawal "to" and capital_injection "from" are Outside (existing movement rules);
  // any other empty side is missing.
  const s = (x, side) => (x === 'missing' ? ((type === 'owner_withdrawal' && side === 'to') || (type === 'capital_injection' && side === 'from') ? 'outside' : 'x') : x.replace(/2$/, ''));
  const A = s(a, 'from'), B = s(b, 'to');
  // N3b: a capital injection without a confirmed own-money agreement (here: no fundingKind, category
  // 'Other') is unclassified whatever its sides (previously: outside → Business = owner contribution).
  if (type === 'capital_injection') return ['unclassified', 'funding_source_unconfirmed'];
  if (A === 'shared' || B === 'shared') return ['unclassified', 'shared_needs_purpose'];
  if (A === 'business' && B === 'business') return ['pharmacy_internal'];
  if (A === 'personal' && B === 'personal') return ['personal_internal'];
  if (A === 'business' && (B === 'personal' || B === 'outside')) return ['owner_withdrawal'];
  if (A === 'personal' && B === 'business') return ['owner_contribution'];
  // 5.3: outside → Business is an owner contribution only for a capital injection reliably identified as
  // the owner's own money (tested with stored agreements below); any other movement from outside into a
  // Business account is unclassified (previously asserted as an owner contribution for every type).
  return ['unclassified'];
}
test('5.3 truth table: transfers, withdrawals and investments by the confirmed ownership of both sides; capital injections without a confirmed own-money agreement fail safe (N3b); purpose never applies', () => {
  let n = 0;
  for (const type of ['transfer', 'owner_withdrawal', 'investment', 'capital_injection']) for (const a of Object.keys(SIDES)) for (const b of Object.keys(SIDES)) {
    const t = e({ type, amount: 30000, fromAcct: SIDES[a], toAcct: SIDES[b], purpose: 'personal' }); // purpose present on purpose: must be ignored
    const s = F.scopeOf(t, CTX), [kind, flag] = expected53(a, b, type), label = `${type} ${a}→${b}`;
    assert.equal(s.kind, kind, label);
    assert.equal(sumParts(s), K(30000), label);
    if (flag) assert.ok(s.flags.includes(flag), label);
    if (kind === 'unclassified') assert.equal(s.basis, 'none', label); else assert.equal(s.basis, 'movement_rule', label);
    n++;
  }
  assert.equal(n, 4 * 10 * 10);
  // D13: a stored transfer Business → Personal is an owner withdrawal; its stored type is not changed.
  const tr = e({ type: 'transfer', amount: 30000, fromAcct: 'opay', toAcct: 'pb' });
  assert.equal(F.scopeOf(tr, CTX).kind, 'owner_withdrawal'); assert.equal(tr.type, 'transfer');
});

test('partition invariant in kobo across awkward amounts, and non-reconciling splits never apply "nearly"', () => {
  for (const amount of [0.01, 0.1, 1, 999.99, 20000.01, 123456.78, 1e7 + 0.03]) {
    for (const acc of ['opay', 'pb', 'sh', OUTSIDE, '', 'un']) {
      const s = F.scopeOf(e({ amount, fromAcct: acc }), CTX);
      assert.equal(sumParts(s), K(amount), `${amount} from ${acc}`);
      for (const v of Object.values(s.parts)) assert.ok(Number.isInteger(v) && v >= 0);
    }
    const ph = Math.floor(amount * 60) / 100, pe = Math.round((amount - ph) * 100) / 100;
    const ok = F.scopeOf(e({ amount, fromAcct: 'sh', split: { pharmacy: ph, personal: pe, method: 'amount' } }), CTX);
    assert.equal(ok.parts.pharmacy + ok.parts.personal, K(amount)); assert.equal(ok.parts.unclassified, 0);
  }
  const off = F.scopeOf(e({ amount: 20000, fromAcct: 'sh', split: { pharmacy: 12000, personal: 7000, method: 'amount' } }), CTX);
  assert.equal(off.kind, 'unclassified'); assert.ok(off.flags.includes('split_does_not_reconcile'));
  const pc = F.scopeOf(e({ amount: 20000, fromAcct: 'sh', split: { pharmacy: 12000, personal: 8000, method: 'percent' } }), CTX);
  assert.equal(pc.kind, 'shared', 'method percent: stored amounts that reconcile are used as stored');
  assert.equal(F.scopeOf(e({ amount: 500, fromAcct: 'opay', split: { pharmacy: 500, personal: 0, method: 'amount' } }), CTX).kind, 'pharmacy');
  assert.equal(F.scopeOf(e({ amount: 500, fromAcct: 'opay', split: { pharmacy: 0, personal: 500, method: 'amount' } }), CTX).kind, 'personal');
});

/* ── Examples A, B, C (5.6) ─────────────────────────────────── */
test('Example A: ₦8,000 gas refill from confirmed Business Opay, purpose Personal — cross-boundary; personal expense and owner withdrawal (direct); not pharmacy opex; Opay −₦8,000', () => {
  const t = e({ amount: 8000, fromAcct: 'opay', purpose: 'personal', desc: 'Gas refill' });
  const s = F.scopeOf(t, CTX);
  assert.equal(s.kind, 'cross_pharmacy_paid_personal'); assert.ok(s.flags.includes('purpose_differs_from_payer'));
  const base = F.financialMeasures(ACCTS, [], { aliases: ALIASES, baselineDate: '2026-10-01', from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' });
  const m = F.financialMeasures(ACCTS, [t], { aliases: ALIASES, baselineDate: '2026-10-01', from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' });
  assert.equal(m.balances.opay - base.balances.opay, -8000);
  assert.equal(m.confirmedPharmacyCash.available - base.confirmedPharmacyCash.available, -8000);
  assert.equal(m.pharmacyOperatingExpenses, 0); assert.equal(m.personalExpenses, 8000); assert.equal(m.ownerWithdrawals, 8000);
  assert.equal(m.pharmacyCashBurn, 0, 'an owner withdrawal (direct) is not pharmacy spending');
});

test('Example B: ₦15,000 fuel for a Personal-purpose vehicle paid from Business Opay — unclassified (defaults_disagree), in pharmacy burn, not opex; after the owner states Personal it is cross-boundary and the resolved conflict stays flagged', () => {
  const opts = { aliases: ALIASES, vehiclePurposes: { green: 'personal' }, baselineDate: '2026-10-01', from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' };
  const t = e({ amount: 15000, fromAcct: 'opay', vehicle: 'green', desc: 'Fuel' });
  const s = F.scopeOf(t, F.scopeContext(ACCTS, opts));
  assert.equal(s.kind, 'unclassified'); assert.ok(s.flags.includes('defaults_disagree'));
  const m = F.financialMeasures(ACCTS, [t], opts);
  assert.equal(m.balances.opay, 385000); assert.equal(m.pharmacyOperatingExpenses, 0);
  assert.equal(m.unresolvedSpendingPharmacyAccounts, 15000); assert.equal(m.pharmacyCashBurn, 15000);
  const edited = { ...t, purpose: 'personal' };
  const s2 = F.scopeOf(edited, F.scopeContext(ACCTS, opts));
  assert.equal(s2.kind, 'cross_pharmacy_paid_personal');
  assert.ok(s2.flags.includes('default_conflict_resolved') && s2.flags.includes('purpose_differs_from_payer'));
  const m2 = F.financialMeasures(ACCTS, [edited], opts);
  assert.equal(m2.balances.opay, 385000, 'classification never moves money');
  assert.equal(m2.unresolvedSpendingPharmacyAccounts, 0); assert.equal(m2.ownerWithdrawals, 15000); assert.equal(m2.personalExpenses, 15000);
});

test('Example C: ₦1,200 lunch from Outside — no balance moves, unclassified, never available; owner states Personal → personal expense, still no balance moves', () => {
  const opts = { aliases: ALIASES, baselineDate: '2026-10-01', from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' };
  const base = F.financialMeasures(ACCTS, [], opts);
  for (const src of [OUTSIDE, 'pers_cash']) {
    const t = e({ amount: 1200, fromAcct: src, desc: 'Lunch' });
    const s = F.scopeOf(t, CTX);
    assert.equal(s.kind, 'unclassified'); assert.ok(s.flags.includes('outside_needs_purpose'));
    const m = F.financialMeasures(ACCTS, [t], opts);
    assert.deepEqual(m.balances, base.balances); assert.equal(m.confirmedPharmacyCash.available, base.confirmedPharmacyCash.available);
    assert.equal(m.unresolvedSpendingOther, 1200); assert.equal(m.unresolvedSpendingPharmacyAccounts, 0); assert.equal(m.pharmacyCashBurn, 0);
    const m2 = F.financialMeasures(ACCTS, [{ ...t, purpose: 'personal' }], opts);
    assert.equal(m2.personalExpenses, 1200); assert.equal(m2.unresolvedSpendingOther, 0); assert.deepEqual(m2.balances, base.balances);
  }
});

/* ── Example 15 (section 6, Q5) ─────────────────────────────── */
test('Example 15: ₦20,000 leaves confirmed Pharmacy Opay, purpose unknown — cash −₦20,000 once, opex unchanged, unresolved +₦20,000, burn +₦20,000, runway lower; classifying it later moves it without touching cash', () => {
  const opts = { aliases: ALIASES, baselineDate: '2026-10-01', from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' };
  const opex = e({ amount: 85000, fromAcct: 'opay', date: '2026-11-05', desc: 'Stock' });
  const before = F.financialMeasures(ACCTS, [opex], opts);
  const unk = e({ amount: 20000, fromAcct: 'opay', date: '2026-11-20', purpose: 'unclassified', desc: 'Unknown' });
  const after = F.financialMeasures(ACCTS, [opex, unk], opts);
  assert.equal(before.balances.opay, 315000); assert.equal(after.balances.opay, 295000);
  assert.equal(after.confirmedPharmacyCash.available - before.confirmedPharmacyCash.available, -20000);
  assert.equal(before.pharmacyOperatingExpenses, 85000); assert.equal(after.pharmacyOperatingExpenses, 85000);
  assert.equal(before.unresolvedSpendingPharmacyAccounts, 0); assert.equal(after.unresolvedSpendingPharmacyAccounts, 20000);
  assert.equal(after.runway.burn - before.runway.burn, 20000);
  assert.ok(after.runway.days < before.runway.days, `runway lower: ${before.runway.days} → ${after.runway.days}`);
  // Classified later as Pharmacy: opex +20,000, unresolved 0; burn and cash unchanged.
  const asPh = F.financialMeasures(ACCTS, [opex, { ...unk, purpose: 'pharmacy' }], opts);
  assert.equal(asPh.pharmacyOperatingExpenses, 105000); assert.equal(asPh.unresolvedSpendingPharmacyAccounts, 0);
  assert.equal(asPh.runway.burn, after.runway.burn); assert.equal(asPh.confirmedPharmacyCash.available, after.confirmedPharmacyCash.available);
  // As Personal: an owner withdrawal (direct), leaving the burn.
  const asPe = F.financialMeasures(ACCTS, [opex, { ...unk, purpose: 'personal' }], opts);
  assert.equal(asPe.ownerWithdrawals, 20000); assert.equal(asPe.runway.burn, before.runway.burn); assert.equal(asPe.pharmacyOperatingExpenses, 85000);
});

/* ── Every measures-table figure on one fixture, hand-calculated ─ */
const OPTS = { aliases: ALIASES, vehiclePurposes: { green: 'personal' }, baselineDate: '2026-10-01', from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' };
function fixture() {
  nid = 1000;
  return [
    e({ amount: 85000, fromAcct: 'opay', desc: 'Stock (pharmacy opex)' }),
    e({ amount: 20000, fromAcct: 'opay', purpose: 'unclassified', desc: 'Example 15' }),
    e({ amount: 8000, fromAcct: 'opay', purpose: 'personal', desc: 'Example A' }),
    e({ amount: 15000, fromAcct: 'opay', vehicle: 'green', desc: 'Example B' }),
    e({ amount: 1200, fromAcct: OUTSIDE, desc: 'Example C' }),
    e({ amount: 3000, fromAcct: 'pers_cash', purpose: 'personal', desc: 'Pocket cash, stated personal' }),
    e({ amount: 15000, fromAcct: 'pb', desc: 'Example 3 groceries' }),
    e({ type: 'transfer', amount: 50000, fromAcct: 'pb', toAcct: 'ps', desc: 'Example 4 savings' }),
    e({ type: 'owner_withdrawal', amount: 100000, fromAcct: 'opay', toAcct: 'pb', desc: 'Example 2' }),
    e({ type: 'transfer', amount: 30000, fromAcct: 'opay', toAcct: 'pb', desc: 'Stored transfer B→P' }),
    e({ type: 'transfer', amount: 50000, fromAcct: 'pb', toAcct: 'opay', desc: 'Example 12' }),
    e({ type: 'capital_injection', amount: 70000, toAcct: 'tb', desc: 'Capital from outside' }),
    e({ type: 'transfer', amount: 10000, fromAcct: 'opay', toAcct: 'tb', desc: 'Pharmacy internal' }),
    e({ amount: 4500, fromAcct: '', state: 'Needs Review', desc: 'Historical, empty source' }),
    e({ amount: 20000, fromAcct: 'sh', desc: 'Shared, no split' }),
    e({ amount: 20000, fromAcct: 'sh', split: { pharmacy: 12000, personal: 8000, method: 'amount' }, desc: 'Example 9 split' }),
    e({ amount: 5000, fromAcct: 'un', desc: 'Unconfirmed Business' }),
    e({ amount: 2000, fromAcct: 'nc', desc: 'Not chosen' }),
    e({ type: 'loan_repayment', amount: 45000, fromAcct: 'opay', alloc: { principal: 40000, interest: 4000, fees: 1000 }, desc: 'Loan (pharmacy payer)' }),
    e({ type: 'loan_repayment', amount: 45000, fromAcct: 'pb', alloc: { principal: 40000, interest: 5000, fees: 0 }, desc: 'Example 13 (personal payer)' }),
    e({ type: 'income', amount: 120000, toAcct: 'opay', desc: 'Sales' }),
    e({ type: 'income', amount: 25000, toAcct: 'pb', desc: 'Personal income' }),
    e({ amount: 6000, fromAcct: 'pb', purpose: 'pharmacy', desc: 'Pharmacy item paid personally' }),
    e({ amount: 2500, fromAcct: 'pharma_cash', desc: 'Legacy pharmacy cash' }),
    e({ amount: 1000, fromAcct: 'pers_bank', desc: 'Legacy, Not used' }),
    e({ type: 'loan_receipt', amount: 200000, toAcct: 'tb', desc: 'Loan received' }),
    e({ amount: 9999, fromAcct: 'opay', voided: true, voidedAt: 'x', desc: 'Voided' }),
    e({ amount: 7777, fromAcct: 'opay', demo: true, desc: 'Sample' }),
    e({ amount: 10000, fromAcct: 'opay', date: '2026-10-15', desc: 'October (window only)' }),
    e({ amount: 7000, fromAcct: 'opay', date: '2026-09-20', purpose: 'unclassified', desc: 'Before the baseline' }),
  ];
}
test('measures table: every figure from one function on a fixture, matching hand-calculated values', () => {
  const txns = fixture(), m = F.financialMeasures(ACCTS, txns, OPTS);
  // Cash layer (unchanged), by hand.
  assert.deepEqual(m.balances, { opay: 244500, tb: 380000, pb: 29000, ps: 50000, sh: 260000, un: 45000, stale: 0, nc: 8000 });
  // Confirmed pharmacy cash: opay 244,500 + tb 380,000 + Shared portion min(100,000, 260,000).
  assert.equal(m.confirmedPharmacyCash.available, 724500);
  assert.equal(m.confirmedPharmacyCash.heldUnresolvedInflows, 0);
  // Classification layer, November.
  // P-D11: no finance cost has a position before stage 6 (previously 5,000 from the Business-paid repayment).
  assert.equal(m.pharmacyFinanceCost, 0);
  assert.equal(m.pharmacyOperatingExpenses, 85000 + 12000 + 6000 + 2500);                         // 105,500 (previously 110,500 incl. 5,000 interest)
  // P-D10: confirmed Business accounts only; the Shared account's unresolved spending is its own figure
  // (previously both together: 55,000).
  assert.equal(m.unresolvedSpendingPharmacyAccounts, 20000 + 15000);                              // 35,000
  assert.equal(m.unresolvedSpendingSharedAccounts, 20000);
  assert.equal(m.unresolvedSpendingPharmacyAccountsPreOpening, 0); assert.equal(m.unresolvedSpendingSharedAccountsPreOpening, 0);
  assert.equal(m.unresolvedSpendingOther, 1200 + 4500 + 5000 + 2000 + 1000);                      // 13,700
  // P-D11: interest and fees by paying account (previously 0 and 0, with the interest in opex and personal expenses).
  assert.equal(m.unresolvedFinanceCostBusinessAccounts, 4000 + 1000); assert.equal(m.unresolvedFinanceCostSharedAccounts, 0);
  assert.equal(m.unresolvedFinanceCostOther, 5000);
  assert.equal(m.provisionalRepaymentsBusinessAccounts, 0); assert.equal(m.provisionalRepaymentsSharedAccounts, 0); assert.equal(m.provisionalRepaymentsOther, 0);
  // Stage 2, P-D18 (owner decision 13 Nov 2026; plan v11 3C.6): the burn counts pharmacy expenditure only where it
  // was paid from confirmed pharmacy cash. The ₦6,000 "Pharmacy item paid personally" is F3 (not in the burn). The
  // ₦12,000 pharmacy part of the Shared-paid split is F2: the Shared balance (₦260,000) stays above its ₦100,000
  // declared portion, so C2 = ₦0 under O1. Previously (Stage 1): 105,500 + 35,000 + 20,000 + 5,000 = 165,500.
  assert.equal(m.pharmacyCashBurn, 105500 - 6000 - 12000 + 35000 + 20000 + 5000);                 // 147,500 (P-D18)
  assert.equal(m.pharmacyOperatingExpenses, 105500, 'pharmacy operating expenditure (B1) is unchanged by P-D18');
  assert.equal(m.personalFinanceCost, 0);
  assert.equal(m.personalExpenses, 8000 + 3000 + 15000 + 8000);                                   // 34,000 (previously 39,000 incl. 5,000 interest)
  assert.equal(m.ownerWithdrawals, 100000 + 30000 + 8000);                                        // 138,000
  // N3b: the capital injection with no agreement is not an owner contribution (previously 126,000 incl. 70,000).
  assert.equal(m.ownerContributions, 50000 + 6000);                                               // 56,000
  assert.equal(m.capitalInjectionsSourceUnconfirmed, 70000);
  // P-D13: receipts split by position (previously one figure, receipts 145,000); all recorded income kept for comparison.
  assert.equal(m.pharmacyReceipts, 120000); assert.equal(m.personalIncome, 25000); assert.equal(m.unresolvedIncome, 0);
  assert.equal(m.allRecordedIncome, 145000);
  // P-D2, P-D11: the loan receipt and the principal of both repayments.
  assert.equal(m.financing, 200000 + 40000 + 40000);                                              // 280,000
  assert.equal(m.externalFunding, 0); assert.equal(m.unresolvedAccountMovements, 0);
  // Runway: window 2026-10-01..2026-11-30 (61 days); burn 147,500 + October 10,000 (P-D18; Stage 1: 165,500 + 10,000).
  assert.equal(m.runway.historyDays, 61); assert.equal(m.runway.windowStart, '2026-10-01');
  // P-D18: burn 147,500 + October 10,000 (previously 165,500 + 10,000 = 175,500, giving 252 days).
  assert.equal(m.runway.burn, 157500); assert.equal(m.runway.days, Math.round(724500 / (157500 / 61)));  // 281 (P-D18; previously 252)
  assert.equal(m.runway.days, 281);
  // Partition over every live November entry; voided, sample and out-of-period entries excluded.
  const live = txns.filter(t => !t.voided && !t.demo && t.date >= '2026-11-01' && t.date <= '2026-11-30');
  assert.equal(m.entries.length, live.length);
  // P-D3: the summary totals are income, expense and obligation parts and loan interest and fees only
  // (previously the parts of every entry, including movements and loans).
  assert.deepEqual([m.scope.pharmacy, m.scope.personal, m.scope.unclassified], [105500 + 120000, 8000 + 3000 + 15000 + 8000 + 25000, 35000 + 20000 + 13700 + 10000]);
  assert.deepEqual(m.scope.separate, { financing: 280000, externalFunding: 0, ownerWithdrawals: 130000, ownerContributions: 50000, internalMovements: 60000,
    provisionalRepayments: 0, unresolvedAccountMovements: 0, capitalInjectionsSourceUnconfirmed: 70000, otherEntries: 0 });
  // Every kobo in exactly one exclusive figure (no amount lost or counted twice).
  const total = live.reduce((s, t) => s + K(t.amount), 0);
  assert.equal(K(m.scope.total), total);
  assert.equal(Object.values(m.scope.exclusive).reduce((s, v) => s + K(v), 0), total);
  assert.equal(m.scope.byKind.unclassified, 20000 + 15000 + 1200 + 4500 + 20000 + 5000 + 2000 + 1000 + 70000);
  assert.equal(m.scope.byKind.financing, 200000); assert.equal(m.scope.byKind.loan_repayment, 90000);
  for (const x of m.entries) {
    if (x.components) { const c = x.components; assert.equal(K(c.principal) + K(c.financeCost.pharmacy) + K(c.financeCost.personal) + K(c.financeCost.unclassified) + K(c.repaymentSplitPending), K(x.amount), x.desc); }
    assert.equal(K(x.parts.pharmacy) + K(x.parts.personal) + K(x.parts.unclassified), K(x.amount), x.desc);
  }
});

test('consistency: where Stage 1 must not change anything, the measures equal the existing calculations', () => {
  const txns = fixture();
  const m = F.financialMeasures(ACCTS, txns, OPTS);
  // Same balances as accountBalances; same confirmed cash as pharmacyCashPosition; "all recorded income"
  // (the transition comparison, P-D13; previously `receipts`) equals classifyTxn income.
  assert.deepEqual(m.balances, F.accountBalances(ACCTS, txns, { baselineDate: OPTS.baselineDate, aliases: ALIASES }));
  const withBal = ACCTS.map(a => ({ ...a, balance: m.balances[a.id] }));
  const held = F.unreconciledInflows(ACCTS, txns, { baselineDate: OPTS.baselineDate, aliases: ALIASES }).byAccount;
  assert.equal(m.confirmedPharmacyCash.available, F.pharmacyCashPosition(withBal, [], { unreconciled: held }).available);
  const inc = txns.filter(t => t.date >= '2026-11-01' && t.date <= '2026-11-30').reduce((s, t) => s + K(F.classifyTxn(t).income), 0);
  assert.equal(K(m.allRecordedIncome), inc);
  assert.equal(K(m.pharmacyReceipts) + K(m.personalIncome) + K(m.unresolvedIncome), inc, 'the three income measures partition recorded income');
  // A pharmacy-only ledger (every expense and loan repayment from confirmed Business accounts, no purpose):
  // pharmacy burn and runway equal the existing spending runway exactly.
  nid = 5000;
  const ph = [e({ amount: 30000, fromAcct: 'opay', date: '2026-10-10' }), e({ type: 'obligation', amount: 12000, fromAcct: 'tb', date: '2026-11-02' }),
    e({ type: 'loan_repayment', amount: 20000, fromAcct: 'opay', date: '2026-11-15', alloc: { principal: 15000, interest: 4000, fees: 1000 } }),
    e({ type: 'owner_withdrawal', amount: 50000, fromAcct: 'opay', toAcct: 'pb', date: '2026-11-16' }), e({ type: 'income', amount: 90000, toAcct: 'opay', date: '2026-11-17' })];
  const pm = F.financialMeasures(ACCTS, ph, OPTS), old = F.spendingRunway(ph, pm.confirmedPharmacyCash.available, { today: OPTS.today, historyStart: OPTS.historyStart });
  assert.equal(pm.runway.burn, old.spending); assert.equal(pm.runway.days, old.days); assert.equal(pm.runway.historyDays, old.historyDays);
  assert.equal(pm.runway.reason, old.reason);
  // P-D11b (a documented conservative change): a provisional repayment from a confirmed Business account is
  // in the pharmacy cash burn; the existing spending runway excludes it.
  const prov = e({ type: 'loan_repayment', amount: 6000, fromAcct: 'opay', date: '2026-11-20', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 6000 }, allocMode: 'provisional' });
  const pm2 = F.financialMeasures(ACCTS, ph.concat(prov), OPTS), old2 = F.spendingRunway(ph.concat(prov), pm2.confirmedPharmacyCash.available, { today: OPTS.today, historyStart: OPTS.historyStart });
  assert.equal(pm2.runway.burn, old2.spending + 6000); assert.equal(pm2.provisionalRepaymentsBusinessAccounts, 6000);
  // The same short-history rule: fewer than 30 days gives no estimate.
  const short = F.financialMeasures(ACCTS, ph, { ...OPTS, historyStart: '2026-11-15' });
  assert.equal(short.runway.known, false); assert.equal(short.runway.reason, 'short_history');
  // classifyTxn is unchanged: the same results as before for every type.
  for (const t of txns) assert.deepEqual(F.classifyTxn(t), F.classifyTxn(JSON.parse(JSON.stringify(t))));
});

test('historical and incomplete records: classified by the same rules, never inferred; a pre-opening outflow from a confirmed pharmacy account stays in the pharmacy-account figure (owner decision R-open, treatment 2)', () => {
  const opts = { aliases: ALIASES, baselineDate: '2026-10-01', from: '2026-09-01', to: '2026-09-30', today: '2026-11-30', historyStart: '2026-10-01' };
  nid = 7000;
  const pre = [e({ amount: 7000, fromAcct: 'opay', date: '2026-09-20', purpose: 'unclassified' }), e({ amount: 3000, fromAcct: 'opay', date: '2026-09-21' })];
  const m = F.financialMeasures(ACCTS, pre, opts);
  // Changed by owner decision R-open (treatment 2): previously this asserted 0 here and 7,000 in "other"
  // (treatment 1, an unapproved inference). The paying account decides the figure, whatever the date.
  assert.equal(m.unresolvedSpendingPharmacyAccounts, 7000, 'paid from confirmed Business Opay: a pharmacy-account figure even before the opening date');
  assert.equal(m.unresolvedSpendingPharmacyAccountsPreOpening, 7000, 'shown as its pre-opening part');
  assert.equal(m.unresolvedSpendingOther, 0, 'not moved to "other" because of its date');
  assert.equal(m.pharmacyOperatingExpenses, 3000, 'classification still applies to history (design 7.1)');
  assert.equal(m.balances.opay, 400000);
  // Nothing inferred from category, description, cash-ness or state.
  for (const o of [{ cat: 'Personal Spending', desc: 'Breakfast' }, { cat: 'Business Overhead', desc: 'Window Repair' }, { cat: 'Fuel', desc: 'fuel kia black' }, { state: 'Needs Review' }, { state: 'AI Categorized' }]) {
    assert.equal(F.scopeOf(e({ amount: 500, fromAcct: '', ...o }), CTX).kind, 'unclassified', JSON.stringify(o));
    assert.equal(F.scopeOf(e({ amount: 500, fromAcct: 'opay', ...o }), CTX).kind, 'pharmacy', JSON.stringify(o));
  }
  // Voided and sample entries are not classified; unknown types are unclassified.
  assert.equal(F.scopeOf(e({ voided: true, fromAcct: 'opay' }), CTX), null);
  assert.equal(F.scopeOf(e({ demo: true, fromAcct: 'opay' }), CTX), null);
  assert.equal(F.scopeOf(e({ type: 'mystery', fromAcct: 'opay' }), CTX).kind, 'unclassified');
  assert.equal(F.scopeOf(null, CTX), null);
  // A removed account (not in setup) is unresolved, never a default.
  assert.ok(F.scopeOf(e({ fromAcct: 'acc_removed' }), CTX).flags.includes('unresolved_source'));
});

test('no silent reclassification: inputs are never changed, results are deterministic, and the stored type is never rewritten', () => {
  const txns = fixture(), accts = JSON.parse(JSON.stringify(ACCTS));
  const t0 = JSON.stringify(txns), a0 = JSON.stringify(accts);
  const m1 = F.financialMeasures(accts, txns, OPTS), m2 = F.financialMeasures(accts, txns, OPTS);
  txns.forEach(t => F.scopeOf(t, F.scopeContext(accts, OPTS)));
  assert.equal(JSON.stringify(txns), t0, 'entries unchanged'); assert.equal(JSON.stringify(accts), a0, 'accounts unchanged');
  assert.equal(JSON.stringify(m1), JSON.stringify(m2), 'same input, same output');
  // Classification follows only the stored entry: changing an unrelated field changes nothing; changing purpose does.
  const t = e({ amount: 5000, fromAcct: 'opay' });
  assert.deepEqual(F.scopeOf({ ...t, desc: 'renamed', cat: 'Personal' }, CTX).parts, F.scopeOf(t, CTX).parts);
  assert.notDeepEqual(F.scopeOf({ ...t, purpose: 'personal' }, CTX).parts, F.scopeOf(t, CTX).parts);
});

/* ── Owner decision R-open (treatment 2): pre-opening outflows from confirmed pharmacy accounts ── */
test('R-open: pre-opening unresolved spending, finance cost and provisional repayments from confirmed Business and Shared accounts stay in their own figures, with pre-opening parts; balances never change; burn counts them only inside the window', () => {
  nid = 8000;
  const pre = '2026-09-20', post = '2026-10-20';
  const txns = [
    e({ amount: 7000, fromAcct: 'opay', date: pre, purpose: 'unclassified', desc: 'Business, pre-opening' }),
    e({ amount: 4000, fromAcct: 'opay', date: post, purpose: 'unclassified', desc: 'Business, after opening' }),
    e({ amount: 6000, fromAcct: 'sh', date: pre, desc: 'Shared unsplit, pre-opening' }),
    e({ amount: 2000, fromAcct: 'sh', date: post, desc: 'Shared unsplit, after opening' }),
    // P-D11: interest and fees are unresolved finance cost until stage 6 whatever purpose the entry carries.
    // (Before the Stage 1 completion these repayments needed purpose 'unclassified' to reach this figure;
    // one now carries purpose 'pharmacy' to prove that the purpose is ignored.)
    e({ type: 'loan_repayment', amount: 21000, fromAcct: 'opay', date: pre, alloc: { principal: 20000, interest: 800, fees: 200 }, desc: 'Business repayment, pre-opening' }),
    e({ type: 'loan_repayment', amount: 10500, fromAcct: 'sh', date: pre, alloc: { principal: 10000, interest: 500, fees: 0 }, desc: 'Shared repayment, pre-opening' }),
    e({ type: 'loan_repayment', amount: 5300, fromAcct: 'opay', date: post, purpose: 'pharmacy', alloc: { principal: 5000, interest: 300, fees: 0 }, desc: 'Business repayment, after opening' }),
    // P-D11b: provisional repayments (split not yet confirmed), Business pre-opening and Shared after opening.
    e({ type: 'loan_repayment', amount: 3000, fromAcct: 'opay', date: pre, alloc: { principal: 0, interest: 0, fees: 0, unsplit: 3000 }, allocMode: 'provisional', desc: 'Business provisional, pre-opening' }),
    e({ type: 'loan_repayment', amount: 1500, fromAcct: 'sh', date: post, desc: 'Shared repayment, no allocation (Q1)' }),
    // Non-pharmacy paying sides keep their treatment, whatever the date.
    e({ amount: 900, fromAcct: '', date: pre, desc: 'Missing payer, pre-opening' }),
    e({ amount: 800, fromAcct: OUTSIDE, date: pre, desc: 'Outside, pre-opening' }),
    e({ amount: 700, fromAcct: 'un', date: pre, desc: 'Unconfirmed Business, pre-opening' }),
    e({ type: 'loan_repayment', amount: 2100, fromAcct: 'pb', date: pre, alloc: { principal: 2000, interest: 100, fees: 0 }, desc: 'Personal repayment, pre-opening' }),
  ];
  const base = { aliases: ALIASES, baselineDate: '2026-10-01', today: '2026-11-30' };
  // A reporting period covering both sides of the opening date.
  const m = F.financialMeasures(ACCTS, txns, { ...base, from: '2026-09-01', to: '2026-10-31', historyStart: '2026-10-01' });
  // P-D10: Business and Shared are separate figures (previously one "pharmacy accounts" figure of 19,000, 13,000 pre-opening).
  assert.equal(m.unresolvedSpendingPharmacyAccounts, 7000 + 4000, 'confirmed Business, before and after opening');
  assert.equal(m.unresolvedSpendingPharmacyAccountsPreOpening, 7000);
  assert.equal(m.unresolvedSpendingSharedAccounts, 6000 + 2000, 'confirmed Shared, before and after opening');
  assert.equal(m.unresolvedSpendingSharedAccountsPreOpening, 6000);
  assert.equal(m.unresolvedSpendingOther, 900 + 800 + 700, 'missing, Outside and unconfirmed payers unchanged; nothing moved here because of its date');
  assert.equal(m.unresolvedFinanceCostBusinessAccounts, 1000 + 300); assert.equal(m.unresolvedFinanceCostBusinessAccountsPreOpening, 1000);
  assert.equal(m.unresolvedFinanceCostSharedAccounts, 500); assert.equal(m.unresolvedFinanceCostSharedAccountsPreOpening, 500);
  assert.equal(m.unresolvedFinanceCostOther, 100, 'Personal payer unchanged');
  assert.equal(m.provisionalRepaymentsBusinessAccounts, 3000); assert.equal(m.provisionalRepaymentsBusinessAccountsPreOpening, 3000);
  assert.equal(m.provisionalRepaymentsSharedAccounts, 1500); assert.equal(m.provisionalRepaymentsSharedAccountsPreOpening, 0);
  assert.equal(m.provisionalRepaymentsOther, 0);
  for (const k of ['unresolvedSpendingPharmacyAccounts', 'unresolvedSpendingSharedAccounts', 'unresolvedFinanceCostBusinessAccounts', 'unresolvedFinanceCostSharedAccounts', 'provisionalRepaymentsBusinessAccounts', 'provisionalRepaymentsSharedAccounts'])
    assert.ok(m[k + 'PreOpening'] <= m[k], `${k}: the pre-opening part is a part of its parent, never added again`);
  assert.equal(m.financing, 20000 + 10000 + 5000 + 2000, 'principal is financing, whatever the paying account or date');
  assert.equal(m.pharmacyOperatingExpenses, 0, 'no finance cost has a position before stage 6');
  assert.equal(m.pharmacyCashBurn, (11000 + 8000) + (1300 + 500) + (3000 + 1500), 'period burn = parent totals once; the pre-opening parts are not added again');
  // Balances (cash layer, 7.1): pre-opening entries never move the account; only entries on/after the baseline do.
  const noTx = F.financialMeasures(ACCTS, [], { ...base, from: '2026-09-01', to: '2026-10-31' });
  assert.equal(m.balances.opay, noTx.balances.opay - 4000 - 5300, 'Opay: only the after-opening outflows move the balance');
  assert.equal(m.balances.sh, noTx.balances.sh - 2000 - 1500, 'Shared: only the after-opening outflows move the balance');
  assert.deepEqual(m.balances, F.accountBalances(ACCTS, txns, { baselineDate: base.baselineDate, aliases: ALIASES }), 'balances exactly as the unchanged cash layer computes them');
  assert.equal(m.confirmedPharmacyCash.available, F.financialMeasures(ACCTS, txns.filter(t => t.date >= '2026-10-01'), { ...base, from: '2026-09-01', to: '2026-10-31' }).confirmedPharmacyCash.available, 'confirmed pharmacy cash ignores pre-opening entries');
  // Runway window starting at the baseline: pre-opening entries are outside it, so they are not in the runway burn.
  assert.equal(m.runway.windowStart, '2026-10-01');
  assert.equal(m.runway.burn, 4000 + 2000 + 300 + 1500, 'runway burn: only entries inside the window');
  // A window that reaches back before the opening date includes them (inside the window, counted once).
  const wide = F.financialMeasures(ACCTS, txns, { ...base, from: '2026-09-01', to: '2026-10-31', historyStart: '2026-09-01' });
  assert.equal(wide.runway.burn, m.pharmacyCashBurn, 'runway burn includes pre-opening amounts inside the window, once');
  // A period entirely before the opening date: still Business and Shared figures, all of them pre-opening.
  const sep = F.financialMeasures(ACCTS, txns, { ...base, from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual([sep.unresolvedSpendingPharmacyAccounts, sep.unresolvedSpendingPharmacyAccountsPreOpening, sep.unresolvedSpendingSharedAccounts, sep.unresolvedSpendingSharedAccountsPreOpening], [7000, 7000, 6000, 6000]);
  assert.deepEqual([sep.unresolvedFinanceCostBusinessAccounts, sep.unresolvedFinanceCostBusinessAccountsPreOpening, sep.unresolvedFinanceCostSharedAccounts, sep.unresolvedFinanceCostSharedAccountsPreOpening], [1000, 1000, 500, 500]);
  assert.deepEqual([sep.provisionalRepaymentsBusinessAccounts, sep.provisionalRepaymentsBusinessAccountsPreOpening], [3000, 3000]);
  assert.equal(sep.pharmacyCashBurn, 7000 + 6000 + 1000 + 500 + 3000);
  // Classification itself is unchanged by date (7.1): same kind and parts before and after the opening date.
  const a = F.scopeOf({ ...txns[1], date: pre }, CTX), b = F.scopeOf(txns[1], CTX);
  assert.deepEqual([a.kind, a.parts, a.payer.ownership], [b.kind, b.parts, b.payer.ownership]);
  const r1 = F.scopeOf({ ...txns[6], date: pre }, CTX), r2 = F.scopeOf(txns[6], CTX);
  assert.deepEqual(r1.components, r2.components);
});

/* ── Obligation router (12.1), read-only ────────────────────── */
test('obligation router: unclassified until reviewed (D8); explicit purposes and exact splits partition the remaining amount; agreements\' existing purpose is never read (stage 6)', () => {
  const ob = { id: 'bill_x@2026-11-10', remaining: 80000, kind: 'bill', billId: 'bill_x' };
  const r0 = F.routeObligation(ob, null);
  assert.deepEqual(r0.parts, { pharmacy: 0, personal: 0, unclassified: 80000 }); assert.equal(r0.basis, 'none');
  assert.deepEqual(F.routeObligation(ob, { purpose: 'personal' }).parts, { pharmacy: 0, personal: 80000, unclassified: 0 });
  assert.deepEqual(F.routeObligation(ob, { purpose: 'pharmacy' }).parts, { pharmacy: 80000, personal: 0, unclassified: 0 });
  assert.deepEqual(F.routeObligation(ob, { purpose: 'shared', split: { pharmacy: 50000, personal: 30000, method: 'amount' } }).parts, { pharmacy: 50000, personal: 30000, unclassified: 0 });
  const bad = F.routeObligation(ob, { purpose: 'shared', split: { pharmacy: 50000, personal: 20000, method: 'amount' } });
  assert.deepEqual(bad.parts, { pharmacy: 0, personal: 0, unclassified: 80000 }); assert.ok(bad.flags.includes('split_does_not_reconcile'));
  assert.ok(F.routeObligation(ob, { purpose: 'shared' }).flags.includes('shared_needs_purpose'));
  // Loan instalments: an agreement's funding purpose ('business' / 'personal' / 'shared') is not an obligation purpose.
  for (const p of ['business', 'personal', 'shared', 'pharmacy']) {
    const r = F.routeObligation({ id: 'agr_1_v1_3', remaining: 45000, agreementId: 'agr_1' }, { purpose: p });
    assert.deepEqual(r.parts, { pharmacy: 0, personal: 0, unclassified: 45000 }, p);
  }
  // Every part sums to the remaining amount, in kobo, for awkward amounts.
  for (const rem of [0.01, 1234.56, 99999.99]) {
    const r = F.routeObligation({ id: 'b', remaining: rem }, null);
    assert.equal(K(r.parts.pharmacy) + K(r.parts.personal) + K(r.parts.unclassified), K(rem));
  }
});

/* ── Stage 1 completion (owner-approved plan; decisions Q1–Q10) ─ */
const AGRS = [
  { id: 'agr_own', name: 'Fictional own money', status: 'active', terms: { nature: 'capital_injection', amount: 25000 } },
  { id: 'agr_own_settled', name: 'Fictional own money, settled', status: 'settled', terms: { nature: 'capital_injection', amount: 1000 } },
  { id: 'agr_debt', name: 'Fictional loan', status: 'active', terms: { nature: 'debt', structure: 'manual', principal: 90000 } },
  { id: 'agr_eq', name: 'Fictional equity', status: 'active', terms: { nature: 'equity', amount: 40000 } },
  { id: 'agr_noterms', name: 'Fictional, no terms', status: 'active' },
  { id: 'agr_noNature', name: 'Fictional, no nature', status: 'active', terms: { amount: 1 } },
  { id: 'agr_case', name: 'Fictional, wrong case', status: 'active', terms: { nature: 'Capital_Injection' } },
  { id: 'agr_dup', terms: { nature: 'capital_injection' } }, { id: 'agr_dup', terms: { nature: 'debt' } },
];
const ACTX = F.scopeContext(ACCTS, { aliases: ALIASES, agreements: AGRS });
const MOPTS = { ...OPTS, agreements: AGRS };
const comp = s => s.components.principal + s.components.financeCost.pharmacy + s.components.financeCost.personal + s.components.financeCost.unclassified + s.components.repaymentSplitPending;

test('N-T1 financing (P-D2, N1 regression): every loan receipt and the legacy "loan received" capture are financing, whatever the receiving account; never income, contribution or external funding', () => {
  for (const acc of ['opay', 'pb', 'sh', 'un', 'nc', OUTSIDE, '', 'pers_bank']) {
    for (const extra of [{}, { purpose: 'personal' }, { split: { pharmacy: 600, personal: 400, method: 'amount' } }]) {
      const r = F.scopeOf(e({ type: 'loan_receipt', amount: 1000, toAcct: acc, ...extra }), ACTX);
      assert.equal(r.kind, 'financing', acc + JSON.stringify(extra)); assert.equal(r.basis, 'financing_rule');
      assert.equal(sumParts(r), K(1000), 'informational parts keep the partition');
    }
    // N1: the legacy capture (capital_injection, category Loan, no fundingKind) — the defect the review found.
    assert.equal(F.scopeOf(e({ type: 'capital_injection', amount: 1000, cat: 'Loan', toAcct: acc }), ACTX).kind, 'financing', 'legacy ' + acc);
  }
  // A capital injection with category Loan AND a fundingKind is not the legacy form: its fundingKind decides.
  assert.equal(F.scopeOf(e({ type: 'capital_injection', amount: 1000, cat: 'Loan', fundingKind: 'gift', toAcct: 'opay' }), ACTX).kind, 'external_funding');
  assert.equal(F.scopeOf(e({ type: 'capital_injection', amount: 1000, cat: 'Loan', fundingKind: 'capital_injection', toAcct: 'opay' }), ACTX).kind, 'unclassified');
  const m = F.financialMeasures(ACCTS, [e({ type: 'loan_receipt', amount: 200000, toAcct: 'tb' }), e({ type: 'capital_injection', amount: 30000, cat: 'Loan', toAcct: 'opay' })], MOPTS);
  assert.equal(m.financing, 230000); assert.equal(m.ownerContributions, 0); assert.equal(m.externalFunding, 0);
  assert.equal(m.pharmacyReceipts + m.personalIncome + m.unresolvedIncome, 0); assert.equal(m.pharmacyCashBurn, 0);
  assert.deepEqual([m.scope.pharmacy, m.scope.personal, m.scope.unclassified], [0, 0, 0], 'not in the summary totals (P-D3)');
  assert.equal(m.scope.separate.financing, 230000);
});

test('N-T2 external funding (N3a): equity, gift, profit-share without repayable principal and other non-loan funding, whatever the receiving account (Q6); never income, contribution or financing', () => {
  for (const fk of ['equity', 'gift', 'profit_share', 'other_non_loan']) for (const acc of ['opay', 'pb', 'sh', 'un']) {
    const r = F.scopeOf(e({ type: 'capital_injection', amount: 5000, fundingKind: fk, toAcct: acc, agreementId: 'agr_eq' }), ACTX);
    assert.equal(r.kind, 'external_funding', fk + ' ' + acc); assert.equal(sumParts(r), K(5000));
  }
  const m = F.financialMeasures(ACCTS, [e({ type: 'capital_injection', amount: 40000, fundingKind: 'equity', toAcct: 'opay' })], MOPTS);
  assert.equal(m.externalFunding, 40000); assert.equal(m.ownerContributions, 0); assert.equal(m.financing, 0); assert.equal(m.allRecordedIncome, 0);
  assert.equal(m.scope.separate.externalFunding, 40000); assert.equal(m.scope.pharmacy, 0);
});

test('N-T3 own-money capital injections (N3b, Q4, Q5, Q7): an owner contribution only with a stored agreement whose exact nature is capital_injection; every other case fails safe and is counted only as "source unconfirmed"', () => {
  const ci = (o) => e({ type: 'capital_injection', amount: 25000, toAcct: 'tb', fundingKind: 'capital_injection', ...o });
  // The one reliable case: outside → confirmed Business with a stored own-money agreement (status ignored, Q5).
  for (const id of ['agr_own', 'agr_own_settled']) assert.equal(F.scopeOf(ci({ agreementId: id }), ACTX).kind, 'owner_contribution', id);
  // With a confirmed own-money agreement, the 5.3 sides still decide (outside → Personal, Shared, unconfirmed: unclassified, not "source unconfirmed").
  for (const acc of ['pb', 'sh', 'un']) { const r = F.scopeOf(ci({ agreementId: 'agr_own', toAcct: acc }), ACTX); assert.equal(r.kind, 'unclassified', acc); assert.ok(!r.flags.includes('funding_source_unconfirmed'), acc); }
  // Fail-safe cases (N3b): never an owner contribution.
  const failSafe = [
    ['no agreementId (Add Entry, Edit)', ci({})], ['agreement not found / deleted', ci({ agreementId: 'agr_gone' })], ['empty id', ci({ agreementId: '' })],
    ['non-string id', ci({ agreementId: 42 })], ['object id', ci({ agreementId: { id: 'agr_own' } })], ['prototype key', ci({ agreementId: 'constructor' })],
    ['agreement is a loan', ci({ agreementId: 'agr_debt' })], ['agreement is equity', ci({ agreementId: 'agr_eq' })], ['agreement has no terms', ci({ agreementId: 'agr_noterms' })],
    ['agreement has no nature', ci({ agreementId: 'agr_noNature' })], ['nature in a different case', ci({ agreementId: 'agr_case' })], ['duplicated agreement id', ci({ agreementId: 'agr_dup' })],
    ['unknown fundingKind', ci({ fundingKind: 'bonus', agreementId: 'agr_own' })], ['non-string fundingKind', ci({ fundingKind: 1 })],
    ['no fundingKind (Quick Capture, older)', e({ type: 'capital_injection', amount: 25000, toAcct: 'tb', cat: 'Capital Injection', desc: 'my own money' })],
    ['Q4: confirmed Personal From side, no agreement', ci({ fromAcct: 'pb' })], ['Q4: Personal From side, no fundingKind', e({ type: 'capital_injection', amount: 25000, fromAcct: 'pb', toAcct: 'tb' })],
    ['Q7: into a Shared account', ci({ toAcct: 'sh' })], ['Q7: into an unconfirmed account', ci({ toAcct: 'un' })],
  ];
  for (const [label, t] of failSafe) {
    const r = F.scopeOf(t, ACTX);
    assert.equal(r.kind, 'unclassified', label); assert.ok(r.flags.includes('funding_source_unconfirmed'), label);
    assert.deepEqual(r.parts, { pharmacy: 0, personal: 0, unclassified: K(25000) }, label);
  }
  // No agreements supplied at all: even the stored own-money reference fails safe.
  assert.ok(F.scopeOf(ci({ agreementId: 'agr_own' }), CTX).flags.includes('funding_source_unconfirmed'));
  // Measures: contributions count only the reliable one; every fail-safe amount is in "source unconfirmed" only (Q7).
  const txns = [ci({ agreementId: 'agr_own' })].concat(failSafe.map(x => x[1]));
  const m = F.financialMeasures(ACCTS, txns, MOPTS);
  assert.equal(m.ownerContributions, 25000); assert.equal(m.capitalInjectionsSourceUnconfirmed, 25000 * failSafe.length);
  assert.equal(m.unresolvedAccountMovements, 0); assert.equal(m.unresolvedIncome, 0); assert.equal(m.pharmacyCashBurn, 0);
  // The agreements are read, never changed.
  const before = JSON.stringify(AGRS); F.financialMeasures(ACCTS, txns, MOPTS); assert.equal(JSON.stringify(AGRS), before);
});

test('N-T4 repayment components contract (P-D11, P-D11e, Q1, Q2): exact partition; interest and fees unresolved until stage 6 whatever the purpose; missing or invalid allocations make the whole amount provisional', () => {
  const rp = (amount, alloc, o = {}) => F.scopeOf(e({ type: 'loan_repayment', amount, fromAcct: 'opay', ...(alloc === undefined ? {} : { alloc }), ...o }), CTX);
  const C = (p, u, pend) => ({ principal: p, financeCost: { pharmacy: 0, personal: 0, unclassified: u }, repaymentSplitPending: pend });
  const cases = [
    ['confirmed', 45000, { principal: 40000, interest: 4000, fees: 1000, unsplit: 0 }, {}, C(K(40000), K(5000), 0), 'confirmed'],
    ['confirmed, no unsplit key', 45000, { principal: 40000, interest: 5000 }, {}, C(K(40000), K(5000), 0), 'confirmed'],
    ['provisional (allocMode)', 20000, { principal: 0, interest: 0, fees: 0, unsplit: 20000 }, { allocMode: 'provisional' }, C(0, 0, K(20000)), 'provisional'],
    ['partly split', 4000, { principal: 3000, interest: 500 }, {}, C(K(3000), K(500), K(500)), 'partial'],
    ['partly split, consistent unsplit', 4000, { principal: 3000, interest: 500, fees: 0, unsplit: 500 }, {}, C(K(3000), K(500), K(500)), 'partial'],
    ['extra principal', 30000, { principal: 30000, interest: 0, fees: 0, unsplit: 0 }, { allocMode: 'extra_principal' }, C(K(30000), 0, 0), 'confirmed'],
    ['awkward kobo', 55455.55, { principal: 37500.33, interest: 17455.22, fees: 500 }, {}, C(K(37500.33), K(17955.22), 0), 'confirmed'],
    ['Q1 missing alloc', 12000, undefined, {}, C(0, 0, K(12000)), 'missing'],
    ['Q1 null alloc', 12000, null, {}, C(0, 0, K(12000)), 'missing'],
    ['Q1 alloc not an object', 12000, 'P 1000', {}, C(0, 0, K(12000)), 'missing'],
    ['Q1 alloc is an array', 12000, [1000, 0], {}, C(0, 0, K(12000)), 'missing'],
    ['Q2 negative principal', 12000, { principal: -1000, interest: 13000 }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 numeric string', 12000, { principal: '10000', interest: 2000 }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 NaN', 12000, { principal: NaN }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 Infinity', 12000, { fees: Infinity }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 fraction of a kobo', 12000, { principal: 1000.005 }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 components above the amount', 12000, { principal: 10000, interest: 3000 }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 inconsistent unsplit (too large)', 12000, { principal: 10000, interest: 1000, unsplit: 5000 }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 inconsistent unsplit (too small)', 12000, { principal: 0, interest: 0, fees: 0, unsplit: 6000 }, { allocMode: 'provisional' }, C(0, 0, K(12000)), 'invalid'],
    ['Q2 invalid unsplit value', 12000, { principal: 12000, unsplit: -1 }, {}, C(0, 0, K(12000)), 'invalid'],
    ['Q2 provisional allocation claiming a split', 12000, { principal: 10000, interest: 0, fees: 0, unsplit: 2000 }, { allocMode: 'provisional' }, C(0, 0, K(12000)), 'invalid'],
    ['entry purpose ignored', 45000, { principal: 40000, interest: 5000 }, { purpose: 'pharmacy' }, C(K(40000), K(5000), 0), 'confirmed'],
    ['entry split ignored', 45000, { principal: 40000, interest: 5000 }, { split: { pharmacy: 45000, personal: 0, method: 'amount' } }, C(K(40000), K(5000), 0), 'confirmed'],
    ['zero amount', 0, { principal: 0 }, {}, C(0, 0, 0), 'none'],
  ];
  for (const [label, amount, alloc, o, want, check] of cases) {
    const r = rp(amount, alloc, o);
    assert.equal(r.kind, 'loan_repayment', label); assert.deepEqual(r.components, want, label); assert.equal(r.allocCheck, check, label);
    assert.equal(comp(r), K(amount), label + ': components partition the amount exactly');
    assert.equal(r.flags.includes('repayment_split_pending'), want.repaymentSplitPending !== 0, label);
  }
  // classifyTxn is unchanged and agrees wherever the stored allocation is valid.
  for (const [label, amount, alloc, o, want, check] of cases) if (check === 'confirmed' || check === 'partial' || check === 'provisional') {
    const c = F.classifyTxn({ type: 'loan_repayment', amount, alloc, ...o });
    assert.equal(K(c.principalRepaid), want.principal, label); assert.equal(K(c.financeCost), want.financeCost.unclassified, label); assert.equal(K(c.unsplitRepaid), want.repaymentSplitPending, label);
  }
  // P-D11e: misleading parts on an entry are never read; only the components feed the measures.
  const t = e({ type: 'loan_repayment', amount: 45000, fromAcct: 'opay', alloc: { principal: 40000, interest: 5000 }, parts: { pharmacy: 45000, personal: 0, unclassified: 0 } });
  const m = F.financialMeasures(ACCTS, [t], MOPTS);
  assert.equal(m.pharmacyOperatingExpenses, 0); assert.equal(m.financing, 40000); assert.equal(m.unresolvedFinanceCostBusinessAccounts, 5000);
  assert.equal(m.pharmacyCashBurn, 5000, 'principal is never in the burn; interest and fees from Business are');
});

test('N-T4b repayment amounts that are not positive (I-4, approved plan 3.2): all components zero, never a negative provisional amount, never lowering the conservative burn; positive amounts keep the Q1 / Q2 and allocation rules', () => {
  const opts = { ...MOPTS, from: '2026-11-01', to: '2026-11-30', today: '2026-11-30', historyStart: '2026-10-01' };
  const Z = { principal: 0, financeCost: { pharmacy: 0, personal: 0, unclassified: 0 }, repaymentSplitPending: 0 };
  const rp = (o) => e({ type: 'loan_repayment', fromAcct: 'opay', date: '2026-11-12', ...o });
  // 1. Zero amount (with and without an allocation).
  for (const o of [{ amount: 0 }, { amount: 0, alloc: { principal: 0, interest: 0, fees: 0, unsplit: 0 } }, { amount: 0, alloc: { principal: 500 } }]) {
    const r = F.scopeOf(rp(o), CTX);
    assert.deepEqual(r.components, Z, JSON.stringify(o)); assert.equal(r.allocCheck, 'none'); assert.ok(!r.flags.includes('repayment_split_pending'));
  }
  // The legacy Number(amount) || 0 reading: a missing or non-numeric amount is 0.
  for (const amount of [undefined, null, '', 'abc', NaN]) assert.deepEqual(F.scopeOf(rp({ amount }), CTX).components, Z, String(amount));
  // 2. Negative amount (with no, invalid or a "valid-looking" allocation, and provisional mode).
  for (const o of [{ amount: -5000 }, { amount: -5000, alloc: { principal: -5000 } }, { amount: -5000, alloc: { principal: 0, interest: 0, fees: 0, unsplit: -5000 }, allocMode: 'provisional' }, { amount: -0.01, alloc: { principal: 1 } }]) {
    const r = F.scopeOf(rp(o), CTX);
    assert.deepEqual(r.components, Z, JSON.stringify(o)); assert.equal(r.allocCheck, 'non_positive_amount'); assert.ok(!r.flags.includes('repayment_split_pending'));
  }
  // Zero and negative repayments cannot reduce the conservative burn (period or runway), from Business or Shared.
  const base = [e({ amount: 10000, fromAcct: 'opay', date: '2026-11-05', purpose: 'unclassified' }), rp({ amount: 3000, alloc: { principal: 0, interest: 0, fees: 0, unsplit: 3000 }, allocMode: 'provisional' })];
  const m0 = F.financialMeasures(ACCTS, base, opts);
  assert.equal(m0.pharmacyCashBurn, 13000);
  const neg = [rp({ amount: -5000 }), rp({ amount: -2000, fromAcct: 'sh' }), rp({ amount: 0 }), rp({ amount: -800, alloc: { principal: 0, interest: 0, fees: 0, unsplit: -800 }, allocMode: 'provisional' })];
  const m1 = F.financialMeasures(ACCTS, base.concat(neg), opts);
  assert.equal(m1.pharmacyCashBurn, m0.pharmacyCashBurn, 'burn unchanged by zero and negative repayments');
  assert.equal(m1.runway.burn, m0.runway.burn, 'runway burn unchanged');
  for (const k of ['provisionalRepaymentsBusinessAccounts', 'provisionalRepaymentsSharedAccounts', 'provisionalRepaymentsOther', 'unresolvedFinanceCostBusinessAccounts', 'unresolvedFinanceCostSharedAccounts', 'financing'])
  { assert.equal(m1[k], m0[k], k + ' unchanged'); assert.ok(m1[k] >= 0, k + ' never negative'); }
  // The stored amount still moves in the cash layer (unchanged): the classification never hides it.
  assert.deepEqual(m1.balances, F.accountBalances(ACCTS, base.concat(neg), { baselineDate: opts.baselineDate, aliases: ALIASES }));
  const ne = m1.entries.find(x => x.amount === -5000); assert.ok(ne, 'the entry is listed with its stored amount'); assert.deepEqual(ne.components, Z);
  // 3. Positive amount, missing allocation (Q1): the whole positive amount is provisional.
  assert.deepEqual(F.scopeOf(rp({ amount: 7000 }), CTX).components, { ...Z, repaymentSplitPending: K(7000) });
  // 4. Positive amount, invalid allocation (Q2): the whole positive amount is provisional.
  const inv = F.scopeOf(rp({ amount: 7000, alloc: { principal: 6000, interest: 2000 } }), CTX);
  assert.deepEqual(inv.components, { ...Z, repaymentSplitPending: K(7000) }); assert.equal(inv.allocCheck, 'invalid');
  // 5. Valid partial allocation: confirmed principal and finance cost kept; the valid remainder is provisional.
  const part = F.scopeOf(rp({ amount: 7000, alloc: { principal: 5000, interest: 800, fees: 200 } }), CTX);
  assert.deepEqual(part.components, { principal: K(5000), financeCost: { pharmacy: 0, personal: 0, unclassified: K(1000) }, repaymentSplitPending: K(1000) });
  assert.equal(part.allocCheck, 'partial');
  const mp = F.financialMeasures(ACCTS, [rp({ amount: 7000, alloc: { principal: 5000, interest: 800, fees: 200 } })], opts);
  assert.deepEqual([mp.financing, mp.unresolvedFinanceCostBusinessAccounts, mp.provisionalRepaymentsBusinessAccounts, mp.pharmacyCashBurn], [5000, 1000, 1000, 2000]);
  // classifyTxn is unchanged (its existing reading of a negative amount is not altered here).
  assert.deepEqual(F.classifyTxn({ type: 'loan_repayment', amount: -5000 }), F.classifyTxn(JSON.parse(JSON.stringify({ type: 'loan_repayment', amount: -5000 }))));
});

test('N-T5 provisional repayment corrected (P-D11b): the amount leaves "provisional" and becomes principal and finance cost; never both', () => {
  const prov = e({ type: 'loan_repayment', amount: 20000, fromAcct: 'opay', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 20000 }, allocMode: 'provisional' });
  const m1 = F.financialMeasures(ACCTS, [prov], MOPTS);
  assert.equal(m1.provisionalRepaymentsBusinessAccounts, 20000); assert.equal(m1.financing, 0); assert.equal(m1.unresolvedFinanceCostBusinessAccounts, 0); assert.equal(m1.pharmacyCashBurn, 20000);
  // The Loans correction voids the provisional entry and records the confirmed split as a new entry.
  const fixed = [{ ...prov, voided: true, voidedAt: 'x' }, e({ type: 'loan_repayment', amount: 20000, fromAcct: 'opay', alloc: { principal: 15000, interest: 4500, fees: 500, unsplit: 0 }, allocMode: 'manual' })];
  const m2 = F.financialMeasures(ACCTS, fixed, MOPTS);
  assert.equal(m2.provisionalRepaymentsBusinessAccounts, 0); assert.equal(m2.financing, 15000); assert.equal(m2.unresolvedFinanceCostBusinessAccounts, 5000);
  assert.equal(m2.pharmacyCashBurn, 5000); assert.equal(m2.balances.opay, m1.balances.opay, 'the cash moved once in both cases');
  assert.equal(K(m2.scope.total), K(20000), 'counted once');
});

test('N-T6 Business, Shared and other kept apart (P-D10, P-D11, P-D11b, R-open); only Business and Shared are in the burn; pre-opening parts are never added again', () => {
  const pre = '2026-09-15', opts = { ...MOPTS, from: '2026-09-01', to: '2026-11-30', historyStart: '2026-09-01' };
  const rows = [];
  for (const [side, acc] of [['business', 'opay'], ['shared', 'sh'], ['other', 'pb'], ['other', OUTSIDE], ['other', ''], ['other', 'un'], ['other', 'nc'], ['other', 'pers_bank']]) for (const date of [pre, '2026-11-10']) {
    rows.push(e({ amount: 1000, fromAcct: acc, date, purpose: 'unclassified' }));
    rows.push(e({ type: 'loan_repayment', amount: 300, fromAcct: acc, date, alloc: { principal: 100, interest: 150, fees: 50 } }));
    rows.push(e({ type: 'loan_repayment', amount: 70, fromAcct: acc, date }));
  }
  const m = F.financialMeasures(ACCTS, rows, opts);
  assert.deepEqual([m.unresolvedSpendingPharmacyAccounts, m.unresolvedSpendingPharmacyAccountsPreOpening, m.unresolvedSpendingSharedAccounts, m.unresolvedSpendingSharedAccountsPreOpening, m.unresolvedSpendingOther], [2000, 1000, 2000, 1000, 12000]);
  assert.deepEqual([m.unresolvedFinanceCostBusinessAccounts, m.unresolvedFinanceCostBusinessAccountsPreOpening, m.unresolvedFinanceCostSharedAccounts, m.unresolvedFinanceCostSharedAccountsPreOpening, m.unresolvedFinanceCostOther], [400, 200, 400, 200, 2400]);
  assert.deepEqual([m.provisionalRepaymentsBusinessAccounts, m.provisionalRepaymentsBusinessAccountsPreOpening, m.provisionalRepaymentsSharedAccounts, m.provisionalRepaymentsSharedAccountsPreOpening, m.provisionalRepaymentsOther], [140, 70, 140, 70, 840]);
  assert.equal(m.financing, 100 * rows.length / 3);
  assert.equal(m.pharmacyCashBurn, 2000 + 2000 + 400 + 400 + 140 + 140, 'Business and Shared parents only; "other" never in the burn');
  assert.equal(m.runway.burn, m.pharmacyCashBurn);
  assert.equal(m.pharmacyOperatingExpenses, 0);
});

test('N-T7 income measures (P-D13, P-D13b, Q-N2 / N2 regression): pharmacy receipts, personal income and unresolved income; income is never a withdrawal or a contribution', () => {
  const inc = (o) => e({ type: 'income', amount: 1000, ...o });
  const cases = [
    ['Business, no purpose', { toAcct: 'opay' }, 'pharmacy', null], ['Personal, no purpose', { toAcct: 'pb' }, 'personal', null],
    ['Business + pharmacy', { toAcct: 'opay', purpose: 'pharmacy' }, 'pharmacy', null],
    ['N2: Business + personal purpose', { toAcct: 'opay', purpose: 'personal' }, 'unclassified', 'purpose_differs_from_payer'],
    ['N2: Personal + pharmacy purpose', { toAcct: 'pb', purpose: 'pharmacy' }, 'unclassified', 'purpose_differs_from_payer'],
    ['Shared, no split', { toAcct: 'sh' }, 'unclassified', 'shared_needs_purpose'], ['Shared + pharmacy purpose', { toAcct: 'sh', purpose: 'pharmacy' }, 'unclassified', 'shared_needs_purpose'],
    ['Shared + valid split', { toAcct: 'sh', split: { pharmacy: 600, personal: 400, method: 'amount' } }, 'split', null],
    // P-D13c: a purpose or a valid split classifies income with no receiving account, warning kept
    // (previously both of the next two cases were unresolved under P-D13b).
    ['missing receiving account', { toAcct: '' }, 'unclassified', 'missing_source'], ['missing + pharmacy purpose', { toAcct: '', purpose: 'pharmacy' }, 'pharmacy', 'missing_source'],
    ['missing + valid split', { toAcct: '', split: { pharmacy: 600, personal: 400, method: 'amount' } }, 'split', 'missing_source'],
    ['unconfirmed + pharmacy purpose', { toAcct: 'un', purpose: 'pharmacy' }, 'pharmacy', 'unconfirmed_account'], ['unconfirmed, no purpose', { toAcct: 'un' }, 'unclassified', 'unconfirmed_account'],
    ['not chosen + personal purpose', { toAcct: 'nc', purpose: 'personal' }, 'personal', 'unconfirmed_account'],
    ['Outside + personal purpose', { toAcct: OUTSIDE, purpose: 'personal' }, 'personal', 'outside_needs_purpose'],
    ['unresolved + pharmacy purpose', { toAcct: 'pers_bank', purpose: 'pharmacy' }, 'pharmacy', 'unresolved_source'],
    ['purpose unclassified', { toAcct: 'opay', purpose: 'unclassified' }, 'unclassified', null], ['split does not reconcile', { toAcct: 'opay', split: { pharmacy: 600, personal: 300, method: 'amount' } }, 'unclassified', 'split_does_not_reconcile'],
  ];
  const want = { pharmacy: 0, personal: 0, unresolved: 0 };
  for (const [label, o, pos, flag] of cases) {
    const r = F.scopeOf(inc(o), CTX);
    assert.ok(!/^(cross_|owner_)/.test(r.kind), label + ': N2');
    if (pos === 'split') { assert.equal(r.kind, 'shared'); want.pharmacy += 600; want.personal += 400; }
    else { assert.equal(r.kind, pos, label); want[pos === 'unclassified' ? 'unresolved' : pos] += 1000; }
    if (flag) assert.ok(r.flags.includes(flag), label + ' ' + r.flags);
    assert.ok(!r.flags.includes('shared_payer'), label + ': shared_payer is never set on income');
  }
  const m = F.financialMeasures(ACCTS, cases.map(c => inc(c[1])), MOPTS);
  assert.deepEqual([m.pharmacyReceipts, m.personalIncome, m.unresolvedIncome], [want.pharmacy, want.personal, want.unresolved]);
  assert.equal(m.allRecordedIncome, 1000 * cases.length); assert.equal(m.ownerWithdrawals, 0); assert.equal(m.ownerContributions, 0);
  assert.equal(m.pharmacyCashBurn, 0);
});

test('N-T7b income with no receiving account (P-D13c, the owner-approved revision of P-D13b): classified by a valid split or explicit purpose with missing_source kept; "of which" figures are subdivisions, never additional income; no account and no confirmed cash until reconciled; the same entry edited counts once; a separate second entry is a known stage 3 risk', () => {
  nid = 9800;
  const inc = (o) => e({ type: 'income', amount: 1000, toAcct: '', ...o });
  // 1. Classification and flags (plan section 1.1); a vehicle gives no default (Q-C).
  const vctx = F.scopeContext(ACCTS, { aliases: ALIASES, agreements: AGRS, vehiclePurposes: { green: 'pharmacy' } });
  const cases = [
    ['valid split', { split: { pharmacy: 600, personal: 400, method: 'amount' } }, 'shared', 'explicit_split', ['missing_source']],
    ['valid split, pharmacy only', { split: { pharmacy: 1000, personal: 0, method: 'amount' } }, 'pharmacy', 'explicit_split', ['missing_source']],
    ['split does not reconcile', { split: { pharmacy: 600, personal: 300, method: 'amount' } }, 'unclassified', 'none', ['split_does_not_reconcile', 'missing_source']],
    ['purpose pharmacy', { purpose: 'pharmacy' }, 'pharmacy', 'explicit_purpose', ['missing_source']],
    ['purpose personal', { purpose: 'personal' }, 'personal', 'explicit_purpose', ['missing_source']],
    ['purpose unclassified', { purpose: 'unclassified' }, 'unclassified', 'none', ['missing_source']],
    ['purpose shared, no split', { purpose: 'shared' }, 'unclassified', 'none', ['shared_needs_purpose', 'missing_source']],
    ['no split, no purpose', {}, 'unclassified', 'none', ['missing_source']],
    ['vehicle only (no default, Q-C)', { vehicle: 'green' }, 'unclassified', 'none', ['missing_source']],
  ];
  for (const [label, o, kind, basis, flags] of cases) {
    const r = F.scopeOf(inc(o), vctx);
    assert.equal(r.kind, kind, label); assert.equal(r.basis, basis, label);
    for (const f of flags) assert.ok(r.flags.includes(f), `${label}: ${f} in ${r.flags}`);
    assert.equal(sumParts(r), K(1000), label);
    assert.ok(!/^(cross_|owner_)/.test(r.kind) && !r.flags.includes('shared_payer'), label);
  }
  // 2. Parent and "of which" figures: subdivisions, never additional income.
  const base = [e({ type: 'income', amount: 50000, toAcct: 'opay', desc: 'Sales' }), e({ type: 'income', amount: 20000, toAcct: 'pb', desc: 'Personal income' }),
    e({ amount: 10000, fromAcct: 'opay', desc: 'Stock' })];
  const ph = inc({ amount: 3500, purpose: 'pharmacy', desc: 'Cash sale, account not recorded' });
  const pe = inc({ amount: 1500, purpose: 'personal', desc: 'Personal receipt, account not recorded' });
  const sp = inc({ amount: 1000, split: { pharmacy: 600, personal: 400, method: 'amount' }, desc: 'Split, account not recorded' });
  const un = inc({ amount: 700, desc: 'No purpose, account not recorded' });
  const noAcct = [ph, pe, sp, un], with_ = base.concat(noAcct);
  const m0 = F.financialMeasures(ACCTS, base, MOPTS), m1 = F.financialMeasures(ACCTS, with_, MOPTS);
  assert.deepEqual([m0.pharmacyReceipts, m0.pharmacyReceiptsNoReceivingAccount, m0.personalIncome, m0.personalIncomeNoReceivingAccount], [50000, 0, 20000, 0]);
  assert.deepEqual([m1.pharmacyReceipts, m1.pharmacyReceiptsNoReceivingAccount], [50000 + 3500 + 600, 3500 + 600]);
  assert.deepEqual([m1.personalIncome, m1.personalIncomeNoReceivingAccount], [20000 + 1500 + 400, 1500 + 400]);
  assert.equal(m1.unresolvedIncome, 700, 'no purpose and no split: unresolved');
  assert.ok(m1.pharmacyReceiptsNoReceivingAccount <= m1.pharmacyReceipts && m1.personalIncomeNoReceivingAccount <= m1.personalIncome, 'each "of which" is a part of its parent');
  assert.equal(m1.pharmacyReceipts - m1.pharmacyReceiptsNoReceivingAccount, m0.pharmacyReceipts, 'parent = ordinary + account-less');
  assert.equal(m1.personalIncome - m1.personalIncomeNoReceivingAccount, m0.personalIncome);
  // Single counting: every total rises by exactly the entries' amount once; the "of which" figures add nothing.
  const added = 3500 + 1500 + 1000 + 700;
  assert.equal(m1.allRecordedIncome - m0.allRecordedIncome, added);
  assert.equal((m1.pharmacyReceipts + m1.personalIncome + m1.unresolvedIncome) - (m0.pharmacyReceipts + m0.personalIncome + m0.unresolvedIncome), added);
  assert.equal(K(m1.scope.total) - K(m0.scope.total), K(added));
  assert.equal(Object.values(m1.scope.exclusive).reduce((s, v) => s + K(v), 0) - Object.values(m0.scope.exclusive).reduce((s, v) => s + K(v), 0), K(added));
  assert.equal((m1.scope.pharmacy + m1.scope.personal + m1.scope.unclassified) - (m0.scope.pharmacy + m0.scope.personal + m0.scope.unclassified), added);
  assert.ok(!Object.keys(m1.scope.exclusive).some(k => /NoAcct|NoReceiving/.test(k)), 'the "of which" figures are not exclusive buckets');
  assert.equal(m1.pharmacyCashBurn, m0.pharmacyCashBurn, 'income is never in the burn');
  // 3. Cash exclusion: no account is assigned; balances, confirmed cash, held inflows and runway cash are unchanged.
  assert.deepEqual(m1.balances, m0.balances);
  assert.deepEqual([m1.confirmedPharmacyCash.available, m1.confirmedPharmacyCash.total, m1.confirmedPharmacyCash.heldUnresolvedInflows], [m0.confirmedPharmacyCash.available, m0.confirmedPharmacyCash.total, m0.confirmedPharmacyCash.heldUnresolvedInflows]);
  assert.equal(m1.runway.days, m0.runway.days);
  // 4. The missing-account warning stays active (unchanged dataQuality, high severity) and every result keeps missing_source.
  const dq = txns => F.dataQuality({ txns, accountIds: ACCTS.map(a => a.id), aliases: ALIASES, baselineDate: MOPTS.baselineDate, today: '2026-11-30' }).find(q => q.key === 'missing_account') || { ids: [] };
  const w1 = dq(with_);
  assert.equal(w1.severity, 'high'); for (const t of noAcct) assert.ok(w1.ids.includes(t.id), 'missing_account lists ' + t.desc);
  for (const t of noAcct) assert.ok(F.scopeOf(t, CTX).flags.includes('missing_source'));
  // 5. Path 1: the SAME entry (same id) edited to add its receiving account (confirmed Business Opay) — counted once.
  const edited = { ...ph, toAcct: 'opay' };
  assert.equal(edited.id, ph.id);
  const m2 = F.financialMeasures(ACCTS, base.concat([edited, pe, sp, un]), MOPTS);
  assert.equal(m2.pharmacyReceipts, m1.pharmacyReceipts, 'parent unchanged: the income was already counted, once');
  assert.equal(m2.pharmacyReceiptsNoReceivingAccount, m1.pharmacyReceiptsNoReceivingAccount - 3500, 'it leaves the "of which" part');
  assert.equal(m2.allRecordedIncome, m1.allRecordedIncome);
  assert.equal(m2.balances.opay - m1.balances.opay, 3500, 'the cash layer now moves the account, once');
  assert.equal(m2.confirmedPharmacyCash.available - m1.confirmedPharmacyCash.available, 3500, 'confirmed pharmacy cash rises by the amount, once');
  assert.equal(m2.entries.filter(x => x.id === ph.id).length, 1, 'one entry, one id');
  assert.ok(!dq(base.concat([edited, pe, sp, un])).ids.includes(ph.id), 'no longer a missing-account finding');
  // 6. Q-F: existing rules apply after reconciliation; still counted exactly once.
  const toPersonal = F.financialMeasures(ACCTS, base.concat([{ ...ph, toAcct: 'pb' }, pe, sp, un]), MOPTS);
  const rP = F.scopeOf({ ...ph, toAcct: 'pb' }, CTX);
  assert.equal(rP.kind, 'unclassified'); assert.ok(rP.flags.includes('purpose_differs_from_payer'), 'N2');
  assert.equal(toPersonal.unresolvedIncome - m1.unresolvedIncome, 3500); assert.equal(m1.pharmacyReceipts - toPersonal.pharmacyReceipts, 3500);
  assert.deepEqual([toPersonal.ownerWithdrawals, toPersonal.ownerContributions], [m1.ownerWithdrawals, m1.ownerContributions], 'never a withdrawal or contribution');
  assert.equal(toPersonal.allRecordedIncome, m1.allRecordedIncome);
  const rS = F.scopeOf({ ...ph, toAcct: 'sh' }, CTX);
  assert.equal(rS.kind, 'unclassified'); assert.ok(rS.flags.includes('shared_needs_purpose'), 'rule 3');
  assert.equal(F.financialMeasures(ACCTS, base.concat([{ ...ph, toAcct: 'sh' }, pe, sp, un]), MOPTS).allRecordedIncome, m1.allRecordedIncome);
  // 7. Path 2 — documented, NOT prevented in Stage 1: a separate second entry for the same money is counted in
  //    addition. Possible-repeat detection that treats a missing side as matching is stage 3 work (P-D13c).
  const second = e({ type: 'income', amount: 3500, toAcct: 'opay', purpose: 'pharmacy', desc: 'Cash sale, recorded again into Opay' });
  const m3 = F.financialMeasures(ACCTS, with_.concat(second), MOPTS);
  assert.notEqual(second.id, ph.id);
  assert.equal(m3.pharmacyReceipts - m1.pharmacyReceipts, 3500, 'known Stage 1 limit: the second entry adds the income again');
  assert.equal(m3.allRecordedIncome - m1.allRecordedIncome, 3500);
});

test('N-T8 payer warnings kept and shared_payer (P-D6, Q8)', () => {
  const ex = (o) => F.scopeOf(e({ amount: 1000, ...o }), CTX);
  for (const [acc, flag] of [[OUTSIDE, 'outside_needs_purpose'], ['', 'missing_source'], ['pers_bank', 'unresolved_source'], ['un', 'unconfirmed_account'], ['nc', 'unconfirmed_account']]) for (const purpose of ['pharmacy', 'personal']) {
    const r = ex({ fromAcct: acc, purpose }); assert.equal(r.kind, purpose); assert.ok(r.flags.includes(flag), acc + ' ' + purpose + ' ' + r.flags);
  }
  for (const purpose of ['pharmacy', 'personal']) { const r = ex({ fromAcct: 'sh', purpose }); assert.equal(r.kind, purpose); assert.deepEqual(r.flags, ['shared_payer']); }
  assert.ok(!ex({ fromAcct: 'sh', purpose: 'unclassified' }).flags.includes('shared_payer'), 'Q8: no shared_payer for purpose unclassified');
  assert.ok(!ex({ fromAcct: 'sh' }).flags.includes('shared_payer')); assert.ok(!ex({ fromAcct: 'opay', purpose: 'pharmacy' }).flags.length);
  const sh = ex({ fromAcct: 'sh', split: { pharmacy: 600, personal: 400, method: 'amount' } }); assert.ok(!sh.flags.includes('shared_payer'), 'a split decides (rule 1); the flag accompanies a purpose');
  // Obligations follow the same rule as expenses.
  assert.deepEqual(F.scopeOf(e({ type: 'obligation', amount: 1000, fromAcct: 'sh', purpose: 'pharmacy' }), CTX).flags, ['shared_payer']);
});

test('N-T9 the two review figures (P-D15): unresolved account movements and capital injections with an unconfirmed source, counted separately; never income, expense or burn', () => {
  const txns = [
    e({ type: 'transfer', amount: 15000, fromAcct: 'sh', toAcct: 'opay' }), e({ type: 'transfer', amount: 4000, fromAcct: 'pb', toAcct: OUTSIDE }),
    e({ type: 'transfer', amount: 3000, fromAcct: OUTSIDE, toAcct: 'opay' }), e({ type: 'investment', amount: 2000, fromAcct: 'un', toAcct: 'opay' }),
    e({ type: 'owner_withdrawal', amount: 1000, fromAcct: 'nc', toAcct: 'pb' }),
    e({ type: 'capital_injection', amount: 25000, fundingKind: 'capital_injection', agreementId: 'agr_own', toAcct: 'pb' }), // own money, but outside → Personal (stage 3)
    e({ type: 'capital_injection', amount: 9000, fundingKind: 'capital_injection', agreementId: 'agr_debt', toAcct: 'tb' }),
    e({ type: 'capital_injection', amount: 70000, toAcct: 'sh' }),
  ];
  const m = F.financialMeasures(ACCTS, txns, MOPTS);
  assert.equal(m.unresolvedAccountMovements, 15000 + 4000 + 3000 + 2000 + 1000 + 25000);
  assert.equal(m.capitalInjectionsSourceUnconfirmed, 9000 + 70000);
  assert.equal(m.ownerContributions, 0, '5.3: a movement from outside into Business is a contribution only for an own-money capital injection');
  assert.equal(m.pharmacyCashBurn, 0); assert.equal(m.allRecordedIncome, 0); assert.deepEqual([m.scope.pharmacy, m.scope.personal, m.scope.unclassified], [0, 0, 0]);
  assert.equal(m.scope.separate.unresolvedAccountMovements, m.unresolvedAccountMovements); assert.equal(m.scope.separate.capitalInjectionsSourceUnconfirmed, m.capitalInjectionsSourceUnconfirmed);
});

test('N-T10 conservation: on a completion fixture and a generated grid, every kobo of every entry is in exactly one exclusive figure; hand-calculated figures', () => {
  nid = 9500;
  const fx = [
    e({ type: 'capital_injection', amount: 30000, cat: 'Loan', toAcct: 'tb', desc: 'F1 legacy loan capture' }),
    e({ type: 'capital_injection', amount: 40000, fundingKind: 'equity', agreementId: 'agr_eq', toAcct: 'opay', desc: 'F2 equity' }),
    e({ type: 'capital_injection', amount: 25000, fundingKind: 'capital_injection', agreementId: 'agr_own', toAcct: 'tb', desc: 'F3 own money' }),
    e({ type: 'capital_injection', amount: 9000, fundingKind: 'capital_injection', agreementId: 'agr_debt', toAcct: 'tb', desc: 'F4 wrong nature' }),
    e({ type: 'loan_repayment', amount: 12000, fromAcct: 'opay', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 12000 }, allocMode: 'provisional', desc: 'F5 provisional, Business' }),
    e({ type: 'loan_repayment', amount: 8000, fromAcct: 'sh', desc: 'F6 no allocation, Shared' }),
    e({ type: 'loan_repayment', amount: 4000, fromAcct: 'pb', alloc: { principal: 3000, interest: 500 }, desc: 'F7 partly split, Personal' }),
    e({ type: 'loan_repayment', amount: 11000, fromAcct: 'sh', alloc: { principal: 10000, interest: 1000, fees: 0, unsplit: 0 }, desc: 'F8 confirmed, Shared' }),
    e({ type: 'income', amount: 9000, toAcct: 'sh', purpose: 'pharmacy', desc: 'F9 Shared income with purpose' }),
    e({ type: 'income', amount: 3500, toAcct: '', purpose: 'pharmacy', desc: 'F10 no receiving account' }),
    e({ type: 'income', amount: 6500, toAcct: 'opay', purpose: 'personal', desc: 'F11 purpose differs (N2)' }),
    e({ type: 'income', amount: 2200, toAcct: 'un', purpose: 'pharmacy', desc: 'F12 unconfirmed + purpose' }),
    e({ type: 'transfer', amount: 15000, fromAcct: 'sh', toAcct: 'opay', desc: 'F13 Shared movement' }),
    e({ type: 'transfer', amount: 4000, fromAcct: 'pb', toAcct: OUTSIDE, desc: 'F14 Personal → Outside' }),
    e({ amount: 7000, fromAcct: 'sh', purpose: 'pharmacy', desc: 'F15 Shared-paid, purpose pharmacy' }),
  ];
  const m = F.financialMeasures(ACCTS, fx, MOPTS);
  const got = {
    financing: m.financing, externalFunding: m.externalFunding, ownerContributions: m.ownerContributions, capitalInjectionsSourceUnconfirmed: m.capitalInjectionsSourceUnconfirmed,
    provB: m.provisionalRepaymentsBusinessAccounts, provS: m.provisionalRepaymentsSharedAccounts, provO: m.provisionalRepaymentsOther,
    finB: m.unresolvedFinanceCostBusinessAccounts, finS: m.unresolvedFinanceCostSharedAccounts, finO: m.unresolvedFinanceCostOther,
    pharmacyReceipts: m.pharmacyReceipts, personalIncome: m.personalIncome, unresolvedIncome: m.unresolvedIncome, allRecordedIncome: m.allRecordedIncome,
    ownerWithdrawals: m.ownerWithdrawals, unresolvedAccountMovements: m.unresolvedAccountMovements, opex: m.pharmacyOperatingExpenses, burn: m.pharmacyCashBurn,
  };
  assert.deepEqual(got, {
    financing: 30000 + 3000 + 10000, externalFunding: 40000, ownerContributions: 25000, capitalInjectionsSourceUnconfirmed: 9000,
    provB: 12000, provS: 8000, provO: 500, finB: 0, finS: 1000, finO: 500,
    // P-D13c: F10 (no receiving account, purpose pharmacy) is a pharmacy receipt with no receiving account
    // (previously unresolved income: pharmacyReceipts 2,200; unresolvedIncome 19,000).
    pharmacyReceipts: 2200 + 3500, personalIncome: 0, unresolvedIncome: 9000 + 6500, allRecordedIncome: 9000 + 3500 + 6500 + 2200,
    // P-D18 (Stage 2; plan v11 3C.6): F15 (₦7,000 pharmacy expense paid from Shared) is F2. The Shared balance
    // (₦268,000 after the period's entries: ₦300,000 − ₦41,000 out + ₦9,000 in) stays above its declared portion, so
    // C2 = ₦0 under O1 and it leaves the burn. Previously (Stage 1): burn 7,000 + 1,000 + 12,000 + 8,000 = 28,000.
    ownerWithdrawals: 0, unresolvedAccountMovements: 15000 + 4000, opex: 7000, burn: 1000 + 12000 + 8000,
  });
  assert.equal(m.pharmacyReceiptsNoReceivingAccount, 3500, 'of which: no receiving account (a subdivision of pharmacy receipts)');
  assert.equal(m.personalIncomeNoReceivingAccount, 0);
  // Card totals (previously pharmacy 9,200 and unresolved 20,500): F10 moves from unresolved to pharmacy.
  assert.deepEqual([m.scope.pharmacy, m.scope.personal, m.scope.unclassified], [7000 + 2200 + 3500, 0, 15500 + 1000 + 500]);
  const total = fx.reduce((s, t) => s + K(t.amount), 0);
  assert.equal(total, K(186200));
  assert.equal(Object.values(m.scope.exclusive).reduce((s, v) => s + K(v), 0), total);
  assert.deepEqual(m.balances, F.accountBalances(ACCTS, fx, { baselineDate: MOPTS.baselineDate, aliases: ALIASES }), 'the cash layer is unchanged');
  // Generated grid: every type × side × purpose × allocation shape conserves every kobo.
  const grid = [];
  for (const type of ['expense', 'obligation', 'income', 'transfer', 'owner_withdrawal', 'investment', 'capital_injection', 'loan_receipt', 'loan_repayment', 'mystery'])
    for (const a of ['opay', 'pb', 'sh', 'un', OUTSIDE, '']) for (const b of ['tb', 'ps', 'sh', 'nc', OUTSIDE, ''])
      for (const extra of [{}, { purpose: 'personal' }, { fundingKind: 'capital_injection', agreementId: 'agr_own' }, { alloc: { principal: 100.01, interest: 3 } }, { alloc: { principal: 'x' } }])
        grid.push(e({ type, amount: 123.45, fromAcct: a, toAcct: b, ...extra }));
  const g = F.financialMeasures(ACCTS, grid, MOPTS);
  assert.equal(Object.values(g.scope.exclusive).reduce((s, v) => s + K(v), 0), K(123.45) * grid.length);
  assert.equal(K(g.scope.separate.otherEntries), K(123.45) * grid.filter(t => t.type === 'mystery').length, 'an undefined type is in no section 6 figure');
});

/* ── Browser: read-only summary on both builds; every other screen unchanged ── */
const STAGE0 = '3359ae0c8efdd0f15574f375c6a0c4205d1ec649';
let server, base, browser, stage0 = {};
const pageFor = { test: () => fs.readFileSync(path.join(ROOT, 'koboflow-test.html')), prod: () => fs.readFileSync(path.join(ROOT, 'koboflow.html')), test0: () => stage0.test, prod0: () => stage0.prod };
const DBN = { test: 'KoboFlowDB-test', test0: 'KoboFlowDB-test', prod: 'KoboFlowDB', prod0: 'KoboFlowDB' };
test.before(async () => {
  if (!pw) return;
  for (const [k, f] of [['test', 'koboflow-test.html'], ['prod', 'koboflow.html']]) { try { stage0[k] = execFileSync('git', ['show', `${STAGE0}:${f}`], { cwd: ROOT, maxBuffer: 1 << 26 }); } catch (err) { stage0[k] = null; } }
  server = http.createServer((req, res) => { const k = new URL(req.url, 'http://x').pathname.replace(/\//g, ''), f = pageFor[k], b = f && f();
    if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }); res.end(b); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await pw.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const iso = d => d.toISOString().slice(0, 10);
function liveSeed() {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const today = `${y}-${String(mo + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, monthStart = today.slice(0, 8) + '01';
  const baseline = iso(new Date(Date.UTC(y, mo - 2, 1)));
  const setup = { id: 'ledgerSetup', mode: 'live', baselineDate: baseline, buckets: [], aliases: { ...ALIASES },
    accounts: ACCTS.map(a => ({ ...a, institution: 'Fictional', primary: a.id === 'opay' })) };
  let i = 9000; const t = (o) => ({ id: i++, type: 'expense', amount: 1000, desc: 'Fictional', cat: 'Other', date: today, time: '09:00', fromAcct: '', toAcct: '', state: 'Manual', ...o });
  const txns = [t({ amount: 85000, fromAcct: 'opay', desc: 'Stock' }), t({ amount: 15000, fromAcct: 'pb', desc: 'Groceries' }), t({ amount: 4500, fromAcct: '', state: 'Needs Review', desc: 'Breakfast' }),
    t({ amount: 1200, fromAcct: 'pers_cash', desc: 'Lunch' }), t({ amount: 20000, fromAcct: 'sh', desc: 'Shared bill' }), t({ type: 'owner_withdrawal', amount: 100000, fromAcct: 'opay', toAcct: 'pb', desc: 'Withdrawal' }),
    t({ type: 'transfer', amount: 50000, fromAcct: 'pb', toAcct: 'opay', desc: 'Contribution' }), t({ type: 'income', amount: 120000, toAcct: 'opay', desc: 'Sales' }), t({ amount: 5000, fromAcct: 'un', desc: 'Unconfirmed' }),
    t({ type: 'loan_repayment', amount: 45000, fromAcct: 'opay', alloc: { principal: 40000, interest: 5000, fees: 0 }, desc: 'Loan' }), t({ amount: 700, fromAcct: 'opay', date: monthStart > baseline ? baseline : monthStart, desc: 'Earlier month' }),
    // Stage 1 completion: financing, an agreement-checked owner contribution, an unconfirmed capital injection, a provisional repayment.
    t({ type: 'loan_receipt', amount: 100000, toAcct: 'tb', desc: 'Loan received' }),
    t({ type: 'capital_injection', amount: 30000, toAcct: 'tb', fundingKind: 'capital_injection', agreementId: 'agr_s1_own', desc: 'Own money' }),
    t({ type: 'capital_injection', amount: 20000, toAcct: 'tb', fundingKind: 'capital_injection', desc: 'Capital, source not confirmed' }),
    t({ type: 'loan_repayment', amount: 6000, fromAcct: 'opay', alloc: { principal: 0, interest: 0, fees: 0, unsplit: 6000 }, allocMode: 'provisional', desc: 'Provisional repayment' })];
  const agreements = [{ id: 'agr_s1_own', name: 'Fictional own money', counterparty: 'Owner (fictional)', category: 'owner', status: 'active', version: 1, accountId: 'tb', agreementDate: monthStart,
    terms: { nature: 'capital_injection', structure: 'manual', amount: 30000, principal: 0, cashReceived: 30000 } }];
  return { setup, txns, agreements, today, monthStart };
}
async function openSeeded(key, seed) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await context.addInitScript(n => { window.__rw = 0; const T = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (s, m) { if (m === 'readwrite' && this.name === n) window.__rw++; return T.apply(this, arguments); }; }, DBN[key]);
  const page = await context.newPage(); page.errors = [];
  page.on('pageerror', er => page.errors.push(er.message)); page.on('dialog', d => d.accept());
  await page.goto(`${base}/${key}/`); await page.waitForSelector('body[data-kf-ready="1"]');
  if (seed) {
    await page.evaluate(([n, s]) => new Promise((res, rej) => { const q = indexedDB.open(n); q.onsuccess = () => { const tx = q.result.transaction(['meta', 'transactions', 'agreements'], 'readwrite'); tx.objectStore('meta').put(s.setup); s.txns.forEach(r => tx.objectStore('transactions').put(r)); (s.agreements || []).forEach(r => tx.objectStore('agreements').put(r)); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; }), [DBN[key], seed]);
    await page.goto(`${base}/${key}/`); await page.waitForSelector('body[data-kf-ready="1"]');
  }
  return { context, page };
}
const snapAll = (page, n) => page.evaluate(n => new Promise(res => { const q = indexedDB.open(n); q.onsuccess = () => { const d = q.result, names = [...d.objectStoreNames].sort(), o = {}; const t = d.transaction(names); let l = names.length; names.forEach(s => { const g = t.objectStore(s).getAll(); g.onsuccess = () => { o[s] = g.result; if (--l === 0) { d.close(); res(JSON.stringify(o)); } }; }); }; }), n);
// Text of every screen, with the Stage 1 card removed (it does not exist in the Stage 0 build).
const screensText = page => page.evaluate(() => { const c = document.getElementById('scope-summary-card'); if (c) c.remove();
  return [...document.querySelectorAll('.screen')].map(s => s.id + ': ' + s.textContent.replace(/\s+/g, ' ').trim()); });

for (const key of ['test', 'prod']) {
  test(`${key === 'test' ? 'TEST build' : 'production candidate'}: the read-only summary shows exactly the engine's parts for every entry this month; nothing is written`, { skip }, async () => {
    const seed = liveSeed(), { context, page } = await openSeeded(key, seed);
    const s0 = await snapAll(page, DBN[key]), rw0 = await page.evaluate(() => window.__rw);
    await page.click('.nav-btn[data-screen="analytics"]');
    await page.waitForSelector('#scope-summary-card:not([style*="display: none"])');
    assert.ok(await page.isVisible('#scope-summary-card'));
    const shown = await page.$$eval('[data-scope-entry]', els => els.map(x => ({ id: Number(x.getAttribute('data-scope-entry')), pharmacy: Number(x.getAttribute('data-pharmacy')), personal: Number(x.getAttribute('data-personal')), unclassified: Number(x.getAttribute('data-unclassified')), kind: x.getAttribute('data-kind') })));
    // Expected: this file's engine (Node) on the same data, for this month's entries.
    const m = F.financialMeasures(seed.setup.accounts, seed.txns, { aliases: seed.setup.aliases, agreements: seed.agreements, baselineDate: seed.setup.baselineDate, from: seed.monthStart, to: seed.today, today: seed.today });
    const want = m.entries.map(x => ({ id: x.id, ...x.parts, kind: x.kind }));
    assert.deepEqual(shown, want);
    assert.ok(want.length >= 10);
    const byDesc = Object.fromEntries(m.entries.map(x => [x.desc, x]));
    assert.equal(byDesc.Stock.kind, 'pharmacy'); assert.equal(byDesc.Groceries.kind, 'personal'); assert.equal(byDesc.Breakfast.kind, 'unclassified');
    assert.equal(byDesc.Withdrawal.kind, 'owner_withdrawal'); assert.equal(byDesc.Contribution.kind, 'owner_contribution'); assert.equal(byDesc['Shared bill'].kind, 'unclassified');
    assert.equal(byDesc['Loan received'].kind, 'financing'); assert.equal(byDesc.Loan.kind, 'loan_repayment');
    assert.equal(byDesc['Own money'].kind, 'owner_contribution', 'N3b: the stored agreement is found by the page and its nature checked');
    assert.ok(byDesc['Capital, source not confirmed'].flags.includes('funding_source_unconfirmed'));
    // Repayment rows show their components (P-D11e).
    const comps = await page.$$eval('[data-principal]', els => els.map(x => [Number(x.getAttribute('data-scope-entry')), Number(x.getAttribute('data-principal')), Number(x.getAttribute('data-finance-cost')), Number(x.getAttribute('data-split-pending'))]));
    assert.deepEqual(comps, m.entries.filter(x => x.components).map(x => [x.id, x.components.principal, x.components.financeCost.unclassified, x.components.repaymentSplitPending]));
    const tot = await page.$$eval('#scope-totals [data-scope]', els => Object.fromEntries(els.map(x => [x.getAttribute('data-scope'), x.textContent])));
    const naira = v => '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2 });
    assert.deepEqual(tot, { pharmacy: naira(m.scope.pharmacy), personal: naira(m.scope.personal), unclassified: naira(m.scope.unclassified) });
    // P-D3: totals are income and spending only (incl. loan interest and fees): Stock 85,000 + Sales 120,000;
    // Groceries 15,000; Breakfast 4,500 + Lunch 1,200 + Shared bill 20,000 + Unconfirmed 5,000 + interest 5,000.
    // Before the Stage 1 completion the totals also held the withdrawal, the contribution and the whole repayment.
    assert.deepEqual([m.scope.pharmacy, m.scope.personal, m.scope.unclassified], [205000, 15000, 35700]);
    // Everything else is listed separately, never in the totals.
    const sep = await page.$$eval('#scope-separate [data-separate]', els => Object.fromEntries(els.map(x => [x.getAttribute('data-separate'), x.textContent])));
    const wantSep = Object.fromEntries(Object.entries(m.scope.separate).filter(([, v]) => v !== 0).map(([k, v]) => [k, naira(v)]));
    assert.deepEqual(Object.keys(sep), Object.keys(wantSep));
    for (const [k, v] of Object.entries(wantSep)) assert.ok(sep[k].endsWith(': ' + v), `${k}: ${sep[k]}`);
    assert.deepEqual(m.scope.separate, { financing: 140000, externalFunding: 0, ownerWithdrawals: 100000, ownerContributions: 80000, internalMovements: 0,
      provisionalRepayments: 6000, unresolvedAccountMovements: 0, capitalInjectionsSourceUnconfirmed: 20000, otherEntries: 0 });
    // The page's engine gives the same result as the Node engine (one engine, both builds).
    const inPage = await page.evaluate(s => KoboFin.financialMeasures(s.setup.accounts, s.txns, { aliases: s.setup.aliases, agreements: s.agreements, baselineDate: s.setup.baselineDate, from: s.monthStart, to: s.today, today: s.today }), seed);
    assert.equal(JSON.stringify(inPage.entries), JSON.stringify(m.entries));
    // Read-only: rendering the summary wrote nothing.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => window.__rw) - rw0, 0, 'no read-write transaction');
    assert.equal(await snapAll(page, DBN[key]), s0, 'every store unchanged, including the agreements read for N3b');
    assert.ok(JSON.parse(s0).agreements.length === 1, 'the seeded agreement is in the snapshot');
    assert.equal(await page.evaluate(() => new Dexie().newFinancialFormat), false);
    assert.deepEqual(page.errors, []); await context.close();
  });

  // Stage 2 (plan v11 6.3): extended, not removed or loosened. In live mode the regions Stage 2 renders from the measures
  // (tests/stage2-regions.js, a closed allow-list) are removed from BOTH pages, exactly as the Stage 1 card is; every
  // other text on every screen must still equal the Stage 0 build, and every [data-stage2] element must lie inside an
  // allow-listed region. Each removed region is checked value by value in tests/stage2-screens-browser.test.js. Demo
  // mode is compared in full, with nothing removed.
  test(`${key === 'test' ? 'TEST build' : 'production candidate'}: every other screen's text is identical to the accepted Stage 0 build, in live and demo mode; demo mode shows no summary`, { skip }, async (t) => {
    if (!stage0[key]) { t.skip('Stage 0 commit not in this checkout'); return; }
    const seed = liveSeed();
    for (const s of [seed, null]) {
      const a = await openSeeded(key, s), b = await openSeeded(key + '0', s);
      const ra = await stage2Texts(a.page, !!s), rb = await stage2Texts(b.page, !!s);
      assert.deepEqual(ra.outside, [], `${s ? 'live' : 'demo'} mode: every Stage 2 element is inside an allow-listed region${s ? '' : ' (demo: none holds text)'}`);
      const ta = ra.texts, tb = rb.texts;
      assert.equal(ta.length, tb.length);
      for (let i = 0; i < ta.length; i++) assert.equal(ta[i], tb[i], `${s ? 'live' : 'demo'} mode, screen ${tb[i].split(':')[0]}`);
      if (!s) {
        const a2 = await openSeeded(key, null);
        assert.equal(await a2.page.isVisible('#scope-summary-card'), false, 'demo mode: no summary');
        assert.equal(await a2.page.$eval('#scope-summary', x => x.innerHTML), '');
        await a2.context.close();
      }
      assert.deepEqual(a.page.errors, []); assert.deepEqual(b.page.errors, []);
      await a.context.close(); await b.context.close();
    }
  });
}
