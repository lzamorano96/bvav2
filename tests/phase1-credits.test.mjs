// Phase 1 per-tier credit model — pure Node: `node tests/phase1-credits.test.mjs`
// Proves: (1) legacy/partner cost path is byte-identical; (2) per-tier math is correct;
// (3) creditCostByTier is INTERNAL-ONLY and partner-facing metrics are mode-invariant.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assess, computeCostCurve } from '../public/js/modules/calcEngine.js';
import { validate } from '../public/js/modules/dataIngestion.js';

const benchmarks = JSON.parse(readFileSync(new URL('../public/data/benchmarks.json', import.meta.url)));

// Default-deal inputs (mirrors input-schema defaults), with explicit per-tier credits.
const inputs = {
  tierCount: 3,
  tier1Units: 250, tier1Price: 69,
  tier2Units: 150, tier2Price: 139,
  tier3Units: 100, tier3Price: 279,
  refundRate: 0.15, costPerCredit: 0.04, monthlyCredits: 100, upfrontCredits: 0,
  tier1CreditsMonthly: 100, tier2CreditsMonthly: 250, tier3CreditsMonthly: 500,
  tier1CreditsUpfront: 0, tier2CreditsUpfront: 0, tier3CreditsUpfront: 0,
};

// 1. computeCostCurve: legacy scalar == single-tier per-tier shape (byte-identical).
const legacy = computeCostCurve({ activeUsers: 200, monthlyCredits: 100, upfrontCredits: 0, costPerCredit: 0.04 }, benchmarks.credits, 12);
const single = computeCostCurve({ tierCredits: [{ tier: 1, activeUsers: 200, monthlyCredits: 100, upfrontCredits: 0 }], costPerCredit: 0.04 }, benchmarks.credits, 12);
assert.equal(single.peakMonthlyCost, legacy.peakMonthlyCost, 'single-tier peak must equal legacy');
assert.equal(single.upfrontCost, legacy.upfrontCost, 'single-tier upfront must equal legacy');
assert.equal(single.cumulativeCost, legacy.cumulativeCost, 'single-tier cumulative must equal legacy');
assert.equal(JSON.stringify(single.series), JSON.stringify(legacy.series), 'series must be identical');
assert.equal(legacy.peakMonthlyCost, 800, 'sanity: 200*100*0.04 = 800');

// 2. Partner/default assess: blended legacy cost, NO per-tier breakdown.
const partner = assess(inputs, benchmarks);                       // no viewMode -> partner/default
assert.equal(partner.metrics.activeUsers, 200, 'activeUsers = round(500*0.40)');
assert.equal(partner.metrics.peakMonthlyCost, 800, 'partner peak = blended 200*100*0.04');
assert.ok(!('creditCostByTier' in partner.series), 'creditCostByTier must NOT exist in partner mode');

// 3. Internal assess: per-tier breakdown present and summing correctly.
const internal = assess(inputs, benchmarks, { viewMode: 'internal' });
assert.ok(Array.isArray(internal.series.creditCostByTier), 'creditCostByTier present in internal mode');
assert.equal(internal.series.creditCostByTier.length, 3, 'one entry per active tier');
// t1: round(250*.4)=100 *100*.04=400 ; t2: round(150*.4)=60 *250*.04=600 ; t3: round(100*.4)=40 *500*.04=800
const peaks = internal.series.creditCostByTier.map((t) => t.peakMonthlyCost);
assert.deepEqual(peaks, [400, 600, 800], 'per-tier peak monthly costs');
assert.equal(internal.metrics.peakMonthlyCost, 1800, 'internal peak = sum of per-tier (400+600+800)');

// 4. Partner-facing metrics are IDENTICAL across modes (credits never touch them).
for (const k of ['netRevenue', 'refundAmount', 'grossRevenue', 'partnerPayout', 'blendedRate', 'marketingValue', 'totalValue', 'payingCustomers']) {
  assert.equal(internal.metrics[k], partner.metrics[k], `metric ${k} must be mode-invariant`);
}

// 5. Per-tier credits fall back to global monthlyCredits when not supplied.
const noPerTier = { ...inputs };
delete noPerTier.tier1CreditsMonthly; delete noPerTier.tier2CreditsMonthly; delete noPerTier.tier3CreditsMonthly;
const fb = assess(noPerTier, benchmarks, { viewMode: 'internal' });
// every tier now uses global 100: peaks = [100*100*.04, 60*100*.04, 40*100*.04] = [400,240,160] = 800 total
assert.equal(fb.metrics.peakMonthlyCost, 800, 'fallback to global credits reproduces blended total');

// 6. RECONCILIATION (the HIGH finding): with uniform per-tier credits == the global rate,
// internal peak must EQUAL partner peak even for unit mixes that don't divide evenly by the
// activation rate — and apportioned active users must sum to the blended total.
for (const mix of [[8, 8, 8], [3, 3, 3, 3, 3], [1, 1, 1], [7, 11, 13]]) {
  const inp = { tierCount: mix.length, refundRate: 0, costPerCredit: 0.04, monthlyCredits: 100, upfrontCredits: 0 };
  mix.forEach((u, i) => {
    inp['tier' + (i + 1) + 'Units'] = u; inp['tier' + (i + 1) + 'Price'] = 50;
    inp['tier' + (i + 1) + 'CreditsMonthly'] = 100; inp['tier' + (i + 1) + 'CreditsUpfront'] = 0;
  });
  const p = assess(inp, benchmarks);
  const it = assess(inp, benchmarks, { viewMode: 'internal' });
  assert.equal(it.metrics.peakMonthlyCost, p.metrics.peakMonthlyCost,
    `uniform credits: internal peak must reconcile to partner peak for mix ${mix}`);
  const sumActive = it.series.creditCostByTier.reduce((s, t) => s + t.activeUsers, 0);
  assert.equal(sumActive, p.metrics.activeUsers, `apportioned active users sum to blended total for mix ${mix}`);
}

// 7. A non-numeric per-tier credit value falls back to the global rate (NOT NaN -> 0).
const garbage = { tierCount: 1, tier1Units: 100, tier1Price: 69, refundRate: 0, costPerCredit: 0.04,
  monthlyCredits: 100, upfrontCredits: 0, tier1CreditsMonthly: 'abc' };
const g = assess(garbage, benchmarks, { viewMode: 'internal' });
// blendedActive = round(100*0.40) = 40; 'abc' -> global 100 => peak = 40*100*0.04 = 160 (NOT 0)
assert.equal(g.series.creditCostByTier[0].peakMonthlyCost, 160, 'garbage per-tier credit falls back to global, not 0');

// 8. Through validate() (the REAL UI path): untouched per-tier fields use SCHEMA defaults
// (100/250/500), confirming the actual production internal-mode numbers.
const schema = JSON.parse(readFileSync(new URL('../public/data/input-schema.json', import.meta.url)));
const rawDefaults = {};
for (const [k, r] of Object.entries(schema.fields)) if (r.default !== undefined) rawDefaults[k] = r.default;
const { inputs: validated, errors } = validate(rawDefaults, schema);
assert.equal(Object.keys(errors).length, 0, 'schema defaults validate cleanly');
const vi = assess(validated, benchmarks, { viewMode: 'internal' });
assert.deepEqual(vi.series.creditCostByTier.map((t) => t.peakMonthlyCost), [400, 600, 800],
  'validated default deal uses graduated per-tier credit defaults (100/250/500)');

console.log('PASS: Phase 1 per-tier credit model — legacy byte-identical, per-tier reconciles to blended, fallback + validate paths correct.');
