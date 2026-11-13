// STAGE 2 — the allow-list of what Stage 2 renders from the measures (plan v11 6.3; narrowed in the acceptance
// correction release). The "every other screen's text is identical to the accepted Stage 0 build" tests remove
// exactly these items from BOTH pages before comparing, as they already remove the Stage 1 card; every other text on
// every screen must still equal the Stage 0 build. The list is closed: every [data-stage2] element the Stage 2 page
// renders must lie inside one of these items (nothing else can be hidden by the marker). In demo mode nothing is
// removed and no [data-stage2] element may hold text. Each removed item is checked value by value elsewhere
// (tests/stage2-screens-browser.test.js: CF6, CF7, R1–R12 and the preservation checks).
//
// Where Stage 2 changes only part of a block, only that part is removed:
//  - the Briefing (#autopilot-body): the two rows whose figures Stage 2 recalculates ("Owner W/D This Month",
//    "Financial Health (rule-of-thumb)") and the two warning sentences Stage 2 rewords (runway, owner withdrawals);
//    every other row, note and warning is still compared with the Stage 0 build;
//  - the Capital summary (#cap-summary): only the "Capital Injected" tile; the other tiles are still compared.
const STAGE2_REGIONS = [
  '#screen-home .grid3:has(#yd-in)', '#yd-note', '#runway-card', '#budget-list', '#score-num', '#score-msg', // Home: yesterday, runway, budgets
  '.tl-day-net',                                                                                              // Timeline daily totals
  '#screen-analytics > :not(.screen-title):not(.screen-sub):not(#scope-summary-card)',                       // Analytics
  '#screen-cashflow > :not(.screen-title):not(.screen-sub)',                                                // Cash Flow
  '#screen-ownerimpact > :not(.screen-title):not(.screen-sub)',                                             // Owner Impact
  '#cap-financing',                                                                                         // Capital: financing summary (new)
  '[data-stage2="director-qualifications"]',                                                                // Director: unresolved qualifications
];
// Rows removed by their own label inside a block that is otherwise still compared.
const STAGE2_LABELLED = [
  { block: '#autopilot-body', row: '.autopilot-row', label: '.autopilot-lbl', labels: ['Owner W/D This Month', 'Financial Health (rule-of-thumb)'] },
  { block: '#cap-summary', row: '.stat-card', label: '.stat-label', labels: ['Capital Injected'] },
  { block: '#director-body', row: '.card', label: '.card-label', labels: ["Today's income"] },
];
// Warning sentences Stage 2 rewords (old and new wording), removed from the Briefing's warning block in both pages.
const STAGE2_WARNING_PATTERNS = ['runway is critical', 'Owner withdrawals exceed 30% of'];
// Runs in the page. live: remove the allow-listed items (and report any [data-stage2] element outside them); demo:
// remove nothing and report any [data-stage2] element that holds text. Returns the text of every screen.
function regionTexts([regions, labelled, warnings, live]) {
  const labelledRows = () => labelled.flatMap(l => [...document.querySelectorAll(`${l.block} ${l.row}`)].filter(r => { const x = r.querySelector(l.label); return x && l.labels.includes(x.textContent.trim()); }));
  const rows = labelledRows();
  const inRegion = el => regions.some(sel => el.closest(sel)) || rows.some(r => r.contains(el));
  const outside = live ? [...document.querySelectorAll('[data-stage2]')].filter(el => !inRegion(el)).map(el => el.getAttribute('data-stage2') || el.id)
    : [...document.querySelectorAll('[data-stage2]')].filter(el => el.textContent.trim() !== '').map(el => el.getAttribute('data-stage2') || el.id);
  if (live) {
    regions.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
    rows.forEach(r => r.remove());
    document.querySelectorAll('#autopilot-body .autopilot-warning').forEach(w => {
      const keep = w.innerHTML.split(/<br\s*\/?>/i).filter(line => !warnings.some(p => line.includes(p)));
      if (keep.length && keep.join('').replace(/<[^>]*>|&#?\w+;|\s/g, '') !== '') w.innerHTML = keep.join('<br>'); else w.remove();
    });
  }
  const card = document.getElementById('scope-summary-card'); if (card) card.remove();
  return { outside, texts: [...document.querySelectorAll('.screen')].map(s => s.id + ': ' + s.textContent.replace(/\s+/g, ' ').trim()) };
}
const stage2Texts = (page, live) => page.evaluate(regionTexts, [STAGE2_REGIONS, STAGE2_LABELLED, STAGE2_WARNING_PATTERNS, live]);
module.exports = { STAGE2_REGIONS, STAGE2_LABELLED, STAGE2_WARNING_PATTERNS, stage2Texts };
