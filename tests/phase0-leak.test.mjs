// Phase 0 leak invariants — pure, runs in plain Node: `node tests/phase0-leak.test.mjs`
// Proves internal economics can never reach a partner via the share-link or the PDF.
import assert from 'node:assert/strict';
import { PARTNER_FIELDS, INTERNAL_FIELDS, isPartnerView, revenueCostRows }
  from '../public/js/modules/viewFields.js';

// 1. No economics key is partner-safe (covers the share-link encoder, which iterates PARTNER_FIELDS).
for (const k of INTERNAL_FIELDS) {
  assert.ok(!PARTNER_FIELDS.includes(k), `LEAK: ${k} is in PARTNER_FIELDS`);
}
assert.ok(!PARTNER_FIELDS.includes('activeUsers'), 'LEAK: activeUsers in PARTNER_FIELDS');

// 2. Partner PDF Revenue rows never expose cost / net-cash; internal includes the extra row.
const m = { grossRevenue: 100000, refundAmount: 15000, netRevenue: 85000,
            blendedRate: 0.27, partnerPayout: 22950, netCashToPartner: 18000 };
const usd = (n) => '$' + Math.round(n);
const partnerRows = revenueCostRows(m, 'partner', usd);
const partnerText = JSON.stringify(partnerRows).toLowerCase();
assert.ok(!partnerText.includes('net cash'), 'LEAK: net-cash row present in partner PDF');
assert.ok(!partnerText.includes('cost'), 'LEAK: cost wording present in partner PDF rows');
assert.equal(partnerRows.length, 4, 'partner rows should be the 4 revenue rows only');
assert.equal(revenueCostRows(m, 'internal', usd).length, 5, 'internal should add the net-cash row');

// 3. Safe-by-default: anything that is not 'internal' is treated as partner.
assert.equal(isPartnerView('partner'), true);
assert.equal(isPartnerView('internal'), false);
assert.equal(isPartnerView(undefined), true);

console.log('PASS: Phase 0 leak invariants hold (' + PARTNER_FIELDS.length + ' partner fields, '
  + INTERNAL_FIELDS.length + ' internal-only fields).');
