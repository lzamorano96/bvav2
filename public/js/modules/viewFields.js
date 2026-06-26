// viewFields.js — the partner/internal SECURITY BOUNDARY, in one place.
//
// PURE: no DOM, no Chart.js, no jsPDF, no fetch. Independently unit-testable in Node
// (see tests/phase0-leak.test.mjs). Everything that decides "can this leave the app
// toward a partner?" lives here so it can be audited and tested in isolation.
//
// INVARIANT: the share-link encoder and the partner-facing PDF must be STRUCTURALLY
// incapable of emitting internal economics (the credit cost basis). They iterate
// PARTNER_FIELDS only and never reference INTERNAL_FIELDS.

// Partner-safe inputs — the only fields ever serialized into a shareable URL hash.
export const PARTNER_FIELDS = [
  'tierCount',
  'tier1Units', 'tier1Price', 'tier2Units', 'tier2Price', 'tier3Units', 'tier3Price',
  'tier4Units', 'tier4Price', 'tier5Units', 'tier5Price',
  'refundRate',
];

// Internal-only economics. NEVER placed in the share-link hash or a partner PDF.
// (Internal state loads from Firestore via ?deal=<slug> in a later phase, so there is
// no "internal URL" to leak through at all.) `activeUsers` is derived in calcEngine
// (40% of total units) and is intentionally NOT round-tripped through the URL.
export const INTERNAL_FIELDS = ['costPerCredit', 'monthlyCredits', 'upfrontCredits'];

// Anything not 'internal' is treated as partner — safe-by-default.
export function isPartnerView(viewMode) {
  return viewMode !== 'internal';
}

// Revenue/Cost table rows for the PDF. The "Net cash to partner" line is derived from
// the credit cost curve, so it is INTERNAL-ONLY. `usd` is injected to keep this pure.
export function revenueCostRows(m, viewMode, usd) {
  const rows = [
    ['Gross revenue', usd(m.grossRevenue)],
    ['Less refunds', '−' + usd(m.refundAmount)],
    ['Net revenue', usd(m.netRevenue)],
    ['Partner payout (blended ' + (m.blendedRate * 100).toFixed(1) + '%)', usd(m.partnerPayout)],
  ];
  if (!isPartnerView(viewMode)) {
    rows.push(['Net cash to partner (after 12-mo costs)', usd(m.netCashToPartner)]);
  }
  return rows;
}
