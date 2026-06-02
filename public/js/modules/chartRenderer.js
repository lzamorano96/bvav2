// chartRenderer.js — Chart Rendering module (M4).
// ONLY module that uses Chart.js (loaded globally via js/lib/chart.umd.min.js).
// Thin wrapper: create once, then update-in-place (no destroy/recreate -> no flicker).
// Maps results.series & results.comparisons to datasets and applies theme tokens.
//
// Charts:
//   [A] chart-waterfall       — revenue waterfall (floating bars)
//   [B] chart-payout-tiers    — tiered rev-share, stacked bar
//   [C] chart-cost-over-time  — 12-month monthly + cumulative lines
//   [D] chart-channels-bar    — 6 marketing channels, horizontal ranked bar
//   [E] chart-marketing-mix   — marketing-value doughnut
//   [F] chart-value-stack     — total value, full-width horizontal stacked bar

const instances = {};           // canvasId -> Chart
let palette;

function theme() {
  if (palette) return palette;
  const cs = getComputedStyle(document.documentElement);
  const v = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
  palette = {
    series: [1,2,3,4,5,6].map((i) => v(`--series-${i}`, '#0ea5e9')),
    accent: v('--color-accent', '#ffbe00'),
    negative: v('--color-negative', '#dc2626'),
    positive: v('--color-positive', '#16a34a'),
    text: v('--color-text', '#1a1a1a'),
    muted: v('--color-muted', '#6b7280'),
  };
  return palette;
}

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd = (n) => money0.format(n);

/** Create-or-update every chart from the results object. */
export function renderAll(results) {
  if (typeof Chart === 'undefined') { console.warn('[BVA] Chart.js not loaded'); return; }
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = theme().muted;

  renderWaterfall(results.comparisons.revenueWaterfall);
  renderPayoutTiers(results.comparisons.payoutTiers);
  renderCostOverTime(results.series.costOverTime, results.metrics.partnerPayout, results.series.costUsage);
  renderChannelsBar(results.comparisons.marketingChannels);
  renderMarketingMix(results.series.marketingMix);
  renderValueStack(results.comparisons.totalValueStack);

  document.querySelectorAll('.chart-box__placeholder').forEach((p) => { p.hidden = true; });
}

/** Create on first call, update data/options in place thereafter. */
function upsert(canvasId, config) {
  const existing = instances[canvasId];
  if (existing) {
    existing.data = config.data;
    existing.options = config.options;
    existing.update();
    return existing;
  }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  instances[canvasId] = new Chart(ctx, config);
  return instances[canvasId];
}

const baseOptions = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (c) => `${c.dataset.label ? c.dataset.label + ': ' : ''}${usd(signedValue(c))}` } },
  },
  ...extra,
});
function signedValue(c) {
  const raw = c.raw;
  if (Array.isArray(raw)) return raw[1] - raw[0];   // floating bar magnitude
  return typeof raw === 'number' ? raw : c.parsed.y ?? c.parsed;
}

// [A] Revenue waterfall — floating bars: [start, end] per step.
function renderWaterfall(steps) {
  const t = theme();
  const data = steps.map((s) => (s.kind === 'decrease'
    ? [s.value < 0 ? 0 : 0, 0]                      // placeholder, recomputed below
    : [0, s.value]));
  // Build floating ranges so refunds visually drop from gross to net.
  const gross = steps[0].value;
  const net = steps[2].value;
  const payout = steps[3].value;
  const ranges = [[0, gross], [net, gross], [0, net], [0, payout]];
  const colors = [t.series[0], t.negative, t.series[2], t.accent];

  upsert('chart-waterfall', {
    type: 'bar',
    data: {
      labels: steps.map((s) => s.label),
      datasets: [{ label: '', data: ranges, backgroundColor: colors, borderRadius: 4 }],
    },
    options: baseOptions({
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => usd(v) } } },
    }),
  });
}

// [B] Tiered rev-share — single stacked bar (Tier 1/2/3).
function renderPayoutTiers(tiers) {
  const t = theme();
  upsert('chart-payout-tiers', {
    type: 'bar',
    data: {
      labels: ['Partner Payout'],
      datasets: tiers.map((tier, i) => ({
        label: `Tier ${tier.tier} (${Math.round(tier.rate * 100)}%)`,
        data: [tier.amount],
        backgroundColor: t.series[i % t.series.length],
        rate: tier.rate,
        span: tier.span,
      })),
    },
    options: baseOptions({
      plugins: { legend: { display: true, position: 'bottom' },
                 // Show the marginal math on hover, e.g. "30% × $50,000 band = $15,000"
                 tooltip: { callbacks: { label: (c) => `${Math.round(c.dataset.rate * 100)}% × ${usd(c.dataset.span)} band = ${usd(c.parsed.y)}` } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => usd(v) } } },
    }),
  });
}

// [C] Cost over time — cumulative cost under Aggressive vs Conservative usage,
// against a dashed Partner Payout reference line: as long as both cost lines stay
// below the payout line, the payout covers the credit obligation.
function renderCostOverTime(series, payout, usage = { aggressive: 0.8, conservative: 0.5 }) {
  const t = theme();
  const pct = (u) => `${Math.round(u * 100)}% use`;
  upsert('chart-cost-over-time', {
    type: 'line',
    data: {
      labels: series.map((p) => `M${p.month}`),
      datasets: [
        { label: `Cumulative — Aggressive (${pct(usage.aggressive)})`, data: series.map((p) => p.cumulativeAggressive),
          borderColor: t.series[1], backgroundColor: t.series[1], tension: 0.3, fill: false },
        { label: `Cumulative — Conservative (${pct(usage.conservative)})`, data: series.map((p) => p.cumulativeConservative),
          borderColor: t.series[3], backgroundColor: t.series[3], tension: 0.3, fill: false },
        { label: 'Partner payout (one-time)', data: series.map(() => payout), borderColor: t.positive,
          borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions({
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom' },
                 tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.parsed.y)}` } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Cumulative cost' }, ticks: { callback: (v) => usd(v) } } },
    }),
  });
}

// [D] Marketing channels — horizontal ranked bar.
function renderChannelsBar(channels) {
  const t = theme();
  upsert('chart-channels-bar', {
    type: 'bar',
    data: {
      labels: channels.map((c) => c.label),
      datasets: [{ label: 'Value', data: channels.map((c) => c.value),
        backgroundColor: channels.map((_, i) => t.series[i % t.series.length]), borderRadius: 4 }],
    },
    options: baseOptions({
      indexAxis: 'y',
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => usd(v) } } },
    }),
  });
}

// [E] Marketing mix — doughnut.
function renderMarketingMix(mix) {
  const t = theme();
  upsert('chart-marketing-mix', {
    type: 'doughnut',
    data: {
      labels: mix.map((m) => m.label),
      datasets: [{ data: mix.map((m) => m.value),
        backgroundColor: mix.map((_, i) => t.series[i % t.series.length]) }],
    },
    options: baseOptions({
      cutout: '58%',
      plugins: {
        legend: { display: true, position: 'right' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${usd(c.parsed)} (${(c.parsed / c.dataset.data.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%)` } },
      },
    }),
  });
}

// [F] Total value stack — single full-width horizontal stacked bar.
function renderValueStack(stack) {
  const t = theme();
  upsert('chart-value-stack', {
    type: 'bar',
    data: {
      labels: ['Total Partnership Value'],
      datasets: stack.map((seg, i) => ({
        label: seg.label,
        data: [seg.value],
        backgroundColor: seg.key === 'payout' ? t.accent : t.series[(i) % t.series.length],
        barThickness: 90,            // bold full-width band (was a thin sliver)
        borderWidth: 1,
        borderColor: '#fff',
      })),
    },
    options: baseOptions({
      indexAxis: 'y',
      plugins: { legend: { display: true, position: 'bottom' },
                 tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.parsed.x)}` } } },
      scales: {
        x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => usd(v) } },
        y: { stacked: true, grid: { display: false } },
      },
    }),
  });
}

/** Snapshot a chart canvas as a PNG data URL (used by exporter at M5). */
export function snapshot(canvasId) {
  return instances[canvasId]?.toBase64Image() ?? null;
}
