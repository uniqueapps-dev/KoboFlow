// STAGE 2 — the allow-list of screen regions that Stage 2 renders from the measures (plan v11 6.3).
// The "every other screen's text is identical to the accepted Stage 0 build" tests remove exactly these regions from
// BOTH pages before comparing, exactly as they already remove the Stage 1 card; every other text on every screen must
// still equal the Stage 0 build. The allow-list is closed: every [data-stage2] element the Stage 2 page renders must lie
// inside one of these regions (nothing else can be hidden by the marker), and in demo mode no region is removed at all
// and no [data-stage2] element holds any text. Each removed region is checked value by value elsewhere
// (tests/stage2-screens-browser.test.js: CF6, CF7, R1–R12).
const STAGE2_REGIONS = [
  '#screen-home .grid3:has(#yd-in)', '#yd-note', '#runway-card', '#autopilot-body', '#budget-list', '#score-num', '#score-msg', // Home: yesterday, runway, briefing, budgets
  '.tl-day-net',                                                                                                                   // Timeline daily totals
  '#screen-analytics > :not(.screen-title):not(.screen-sub):not(#scope-summary-card)',                                            // Analytics
  '#screen-cashflow > :not(.screen-title):not(.screen-sub)',                                                                     // Cash Flow
  '#screen-ownerimpact > :not(.screen-title):not(.screen-sub)',                                                                  // Owner Impact
  '#cap-summary', '#cap-financing',                                                                                              // Capital: financing summary
  '[data-stage2="director-qualifications"]',                                                                                     // Director: unresolved qualifications
];
const DIRECTOR_INCOME_LABEL = "Today's income";                                                                                  // Director: today's income card
// Runs in the page. live: remove the regions (and report any [data-stage2] element outside them); demo: remove nothing
// and report any [data-stage2] element that holds text. Returns the text of every screen, as the Stage 1 tests read it.
function regionTexts([regions, label, live]) {
  const inRegion = el => regions.some(sel => el.closest(sel)) || !!(el.closest('#director-body .card') && el.closest('#director-body .card').querySelector('.card-label') && el.closest('#director-body .card').querySelector('.card-label').textContent.trim() === label);
  const outside = live ? [...document.querySelectorAll('[data-stage2]')].filter(el => !inRegion(el)).map(el => el.getAttribute('data-stage2') || el.id)
    : [...document.querySelectorAll('[data-stage2]')].filter(el => el.textContent.trim() !== '').map(el => el.getAttribute('data-stage2') || el.id);
  if (live) {
    regions.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
    document.querySelectorAll('#director-body .card').forEach(c => { const l = c.querySelector('.card-label'); if (l && l.textContent.trim() === label) c.remove(); });
  }
  const card = document.getElementById('scope-summary-card'); if (card) card.remove();
  return { outside, texts: [...document.querySelectorAll('.screen')].map(s => s.id + ': ' + s.textContent.replace(/\s+/g, ' ').trim()) };
}
const stage2Texts = (page, live) => page.evaluate(regionTexts, [STAGE2_REGIONS, DIRECTOR_INCOME_LABEL, live]);
module.exports = { STAGE2_REGIONS, DIRECTOR_INCOME_LABEL, stage2Texts };
