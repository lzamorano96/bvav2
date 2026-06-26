// calcEngine.js — Calculation Engine module (M2).
//
// PURE functions only: no DOM, no fetch, no Chart.js. Independently unit-testable.
// `assess()` transforms validated inputs + benchmarks + config into the results object
// consumed by uiController (numbers) and chartRenderer (charts A–F).
//
// results = {
//   metrics:     { grossRevenue, refundAmount, netRevenue,
//                  partnerPayout, blendedRate,
//                  marketingValue, totalValue,
//                  upfrontCost, peakMonthlyCost, month12Cost, cumulativeCost12 },
//   series:      { costOverTime: [{month, monthly, cumulative}], marketingMix: [{key,label,value,pct}] },
//   comparisons: { revenueWaterfall, payoutTiers, marketingChannels, totalValueStack },
// }

// Assumed share of buyers (blended across all tiers) that remain active and
// consume credits. Derived — not a user input.
const ACTIVATION_RATE = 0.40;

export function assess(inputs, benchmarks, config = {}) {
  const horizon = config.costHorizonMonths || 12;

  const revenue = computeRevenue(inputs);              // sums active tiers (1..tierCount)
  // Paying Customers = units sold minus refunds, rounded to whole people.
  const payingCustomers = Math.round(revenue.totalUnits * (1 - (inputs.refundRate || 0)));
  // Active users (credit-consuming) = 40% of total units sold across all tiers.
  const activeUsers = Math.round(revenue.totalUnits * ACTIVATION_RATE);

  // INTERNAL view models credits PER TIER (each tier its own allotment). The partner /
  // default view keeps the simpler blended model, so its outputs stay byte-identical to
  // before this change. (Phase 2 wires viewMode='internal' + the per-tier UI; until then
  // the per-tier path is dormant — nothing in the live app passes config.viewMode.)
  const internal = config.viewMode === 'internal';

  const payout  = computeTieredPayout(revenue.netRevenue, benchmarks.revShareTiers);
  const market  = computeMarketingValue(benchmarks.marketingChannels, payingCustomers, inputs.marketing, revenue.netRevenue);
  const cost    = internal
    ? computeCostCurve({ tierCredits: buildTierCredits(inputs), costPerCredit: inputs.costPerCredit }, benchmarks.credits, horizon)
    : computeCostCurve({ activeUsers, upfrontCredits: inputs.upfrontCredits, monthlyCredits: inputs.monthlyCredits, costPerCredit: inputs.costPerCredit }, benchmarks.credits, horizon);

  const totalValue = round2(payout.partnerPayout + market.marketingValue);

  // Cost recovery: how much of the payout survives the first 12 months of credit
  // costs, and how many months the payout fully covers before cumulative cost catches up.
  const netCashToPartner = round2(payout.partnerPayout - cost.cumulativeCost);
  let coveredMonths = 0;
  for (const p of cost.series) {
    if (p.cumulativeAggressive <= payout.partnerPayout) coveredMonths = p.month; else break;
  }
  const fullyCovered = cost.cumulativeCost <= payout.partnerPayout;

  return {
    metrics: {
      totalUnits:       revenue.totalUnits,
      payingCustomers,
      totalCustomers:   payingCustomers,        // alias for channel-card {customers} copy
      exposureViews:    market.exposureViews,   // subjective "X more views!" callout
      activeUsers,
      activationRate:   ACTIVATION_RATE,
      grossRevenue:     revenue.grossRevenue,
      refundAmount:     revenue.refundAmount,
      netRevenue:       revenue.netRevenue,
      partnerPayout:    payout.partnerPayout,
      blendedRate:      payout.blendedRate,
      marketingValue:   market.marketingValue,
      totalValue,
      upfrontCost:      cost.upfrontCost,
      peakMonthlyCost:  cost.peakMonthlyCost,
      month12Cost:      cost.lastMonthCost,
      cumulativeCost12: cost.cumulativeCost,
      netCashToPartner,
      coveredMonths,
      fullyCovered,
    },
    series: {
      costOverTime: cost.series,
      costUsage: { aggressive: cost.usageAggressive, conservative: cost.usageConservative },
      marketingMix: market.mix,
      // Per-tier credit-cost breakdown is INTERNAL-ONLY — never built in partner/default view.
      ...(internal ? { creditCostByTier: cost.byTier } : {}),
    },
    comparisons: {
      revenueWaterfall: buildWaterfall(revenue, payout),
      payoutTiers:      payout.tiers,
      marketingChannels: market.channels,           // sorted desc
      totalValueStack:  buildValueStack(payout, market),
    },
  };
}

// --- Revenue: sum of active license tiers, minus refunds ---------------------
// Sums (units × price) across tiers 1..tierCount (1–5). One shared refund rate.
export function computeRevenue(inputs) {
  const n = Math.max(1, Math.min(5, inputs.tierCount || 3));
  let grossRevenue = 0, totalUnits = 0;
  for (let i = 1; i <= n; i++) {
    const u = inputs['tier' + i + 'Units'] || 0;
    const p = inputs['tier' + i + 'Price'] || 0;
    grossRevenue += u * p;
    totalUnits += u;
  }
  grossRevenue = round2(grossRevenue);
  const refundAmount = round2(grossRevenue * (inputs.refundRate || 0));
  const netRevenue   = round2(grossRevenue - refundAmount);
  return { grossRevenue, refundAmount, netRevenue, totalUnits };
}

// --- Stepped rev-share over net revenue ---------------------------------------
export function computeTieredPayout(netRevenue, tiers) {
  const out = [];
  let partnerPayout = 0;
  for (const t of tiers) {
    const upper = t.to == null ? netRevenue : Math.min(t.to, netRevenue);
    const span  = Math.max(0, upper - t.from);
    const amount = round2(span * t.rate);
    if (span > 0) out.push({ tier: t.tier, rate: t.rate, from: t.from, to: t.to, span: round2(span), amount });
    partnerPayout += amount;
  }
  partnerPayout = round2(partnerPayout);
  const blendedRate = netRevenue > 0 ? partnerPayout / netRevenue : 0;
  return { partnerPayout, blendedRate, tiers: out };
}

// --- Marketing value: per-channel valuations (toggleable) --------------------
// `enabled` is an optional map { channelKey: bool }; null/undefined ⇒ all on.
// Disabled channels are excluded from value, charts, and exposure. Verified
// Reviews scales with payingCustomers × ratePerReview. Channels with
// pctOfNetRevenue scale with deal size, clamped to [minValue, maxValue]
// (directional-upside ranges from marketing). Others use flat defaultValue.
// exposureViews sums the audience reach of enabled channels.
export function computeMarketingValue(channelDefs, payingCustomers = 0, enabled = null, netRevenue = 0) {
  const isOn = (key) => !enabled || enabled[key] !== false;
  let exposureViews = 0;
  const channels = Object.entries(channelDefs)
    .filter(([key]) => isOn(key))
    .map(([key, c]) => {
      exposureViews += (c.reach || c.sumolings || 0);
      const value = key === 'verifiedReviews'
        ? round2(payingCustomers * (c.ratePerReview ?? 35))
        : c.pctOfNetRevenue != null
          ? round2(clamp(netRevenue * c.pctOfNetRevenue, c.minValue ?? 0, c.maxValue ?? Infinity))
          : c.defaultValue;
      return { key, label: c.label, value };
    })
    .sort((a, b) => b.value - a.value);
  const marketingValue = round2(channels.reduce((s, c) => s + c.value, 0));
  const mix = channels.map((c) => ({ ...c, pct: marketingValue ? c.value / marketingValue : 0 }));
  return { marketingValue, channels, mix, exposureViews };
}

// --- Credit cost curve: upfront + monthly geometric decline to -declineByM12 --
// Accepts EITHER a per-tier shape { tierCredits:[{tier,activeUsers,monthlyCredits,upfrontCredits}], costPerCredit }
// OR the legacy scalar shape { activeUsers, monthlyCredits, upfrontCredits, costPerCredit }. The scalar form is
// normalized to a single tier, so legacy/partner callers get byte-identical output (round2 is idempotent, so
// rounding per-tier then summing one tier == rounding once). upfront/peak costs are tier-sums; the geometric
// decay + usage-scenario series math is unchanged and runs on the summed peak monthly cost.
export function computeCostCurve(args, credits, horizon) {
  const costPerCredit = args.costPerCredit || 0;
  const tiers = Array.isArray(args.tierCredits)
    ? args.tierCredits
    : [{ tier: 1, activeUsers: args.activeUsers || 0, monthlyCredits: args.monthlyCredits || 0, upfrontCredits: args.upfrontCredits || 0 }];

  const byTier = tiers.map((t) => ({
    tier:            t.tier ?? null,
    activeUsers:     t.activeUsers || 0,
    upfrontCost:     round2((t.activeUsers || 0) * (t.upfrontCredits || 0) * costPerCredit),
    peakMonthlyCost: round2((t.activeUsers || 0) * (t.monthlyCredits || 0) * costPerCredit),
  }));
  const upfrontCost     = round2(byTier.reduce((s, t) => s + t.upfrontCost, 0));
  // Full monthly allotment (100% usage), month 1 — drives the peak/month-12 figures.
  const peakMonthlyCost = round2(byTier.reduce((s, t) => s + t.peakMonthlyCost, 0));

  // Geometric monthly decay so month `horizon` equals peak * (1 - declineByM12).
  const decline = credits.monthlyDeclineByM12 ?? 0;
  const decay = horizon > 1 ? Math.pow(1 - decline, 1 / (horizon - 1)) : 1;

  // Two usage scenarios scale the monthly consumption; upfront (activation) is fixed.
  const uAgg = credits.usageAggressive ?? 1;
  const uCon = credits.usageConservative ?? 0.5;

  const series = [];
  let cumAgg = upfrontCost, cumCon = upfrontCost, lastFull = peakMonthlyCost;
  for (let m = 1; m <= horizon; m++) {
    const monthlyFull = round2(peakMonthlyCost * Math.pow(decay, m - 1));
    lastFull = monthlyFull;
    cumAgg = round2(cumAgg + monthlyFull * uAgg);
    cumCon = round2(cumCon + monthlyFull * uCon);
    series.push({ month: m, monthly: monthlyFull, cumulativeAggressive: cumAgg, cumulativeConservative: cumCon });
  }
  return {
    upfrontCost,
    peakMonthlyCost,
    lastMonthCost: lastFull,
    cumulativeCost: cumAgg,                 // aggressive (prudent) case drives Cost Recovery
    cumulativeConservative: cumCon,
    usageAggressive: uAgg,
    usageConservative: uCon,
    series,
    byTier,                                 // per-tier upfront/peak breakdown (internal view)
  };
}

// --- Chart shapes -------------------------------------------------------------
function buildWaterfall(revenue, payout) {
  return [
    { label: 'Gross Revenue',  value: revenue.grossRevenue, kind: 'total' },
    { label: 'Refunds',        value: -revenue.refundAmount, kind: 'decrease' },
    { label: 'Net Revenue',    value: revenue.netRevenue,    kind: 'subtotal' },
    { label: 'Partner Payout', value: payout.partnerPayout,  kind: 'result' },
  ];
}

function buildValueStack(payout, market) {
  return [
    { label: 'Partner Payout', value: payout.partnerPayout, key: 'payout' },
    ...market.channels.map((c) => ({ label: c.label, value: c.value, key: c.key })),
  ];
}

// Build per-tier credit inputs for the INTERNAL cost model. The blended active-user
// count — round(totalUnits × ACTIVATION_RATE), the SAME integer the partner view uses —
// is apportioned across tiers by unit share via largest-remainder, so the per-tier
// active users sum EXACTLY to the blended total. This makes the per-tier cost a faithful
// decomposition: when every tier shares the global credit rate, internal cost == partner
// cost. Per-tier credit allotments fall back to the global monthly/upfront figures when a
// per-tier value is missing or non-numeric.
function buildTierCredits(inputs) {
  const n = Math.max(1, Math.min(5, inputs.tierCount || 3));
  const units = [];
  let totalUnits = 0;
  for (let i = 1; i <= n; i++) {
    const u = inputs['tier' + i + 'Units'] || 0;
    units.push(u);
    totalUnits += u;
  }
  const blendedActive = Math.round(totalUnits * ACTIVATION_RATE);
  const active = apportion(blendedActive, units, totalUnits);
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      tier: i,
      activeUsers: active[i - 1],
      monthlyCredits: numOr(inputs['tier' + i + 'CreditsMonthly'], inputs.monthlyCredits || 0),
      upfrontCredits: numOr(inputs['tier' + i + 'CreditsUpfront'], inputs.upfrontCredits || 0),
    });
  }
  return out;
}

// Largest-remainder apportionment: split integer `total` into integer parts proportional
// to `weights` (which sum to `weightSum`); the parts sum exactly to `total`.
function apportion(total, weights, weightSum) {
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  const ideal = weights.map((w) => (total * w) / weightSum);
  const out = ideal.map((x) => Math.floor(x));
  let remainder = total - out.reduce((s, x) => s + x, 0);
  const byFrac = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byFrac.length && remainder > 0; k++) { out[byFrac[k].i] += 1; remainder--; }
  return out;
}

// Coerce to a finite number, else fall back. Non-numeric ('abc') falls back too —
// it must NOT slip through as NaN (which would later be swallowed to 0).
function numOr(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
