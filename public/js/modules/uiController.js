// uiController.js — UI Controller module (M3).
// Binds inputs to state, debounces recalc triggers, formats numbers, populates KPI
// cards / channel cards / assumptions, manages error states. Holds NO math,
// instantiates NO charts.

let fmtCurrency, fmtPercent;

/** Build locale/currency formatters once from config. */
export function initFormat(config = {}) {
  const locale = config.locale || 'en-US';
  const currency = config.currency || 'USD';
  fmtCurrency = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  fmtPercent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
}
export const money = (n) => (fmtCurrency ? fmtCurrency.format(n) : `$${n}`);
export const percent = (n) => (fmtPercent ? fmtPercent.format(n) : `${(n * 100).toFixed(1)}%`);

/** Paint the 3 headline KPI boxes + the total callout. */
export function paintKpis(results) {
  const m = results.metrics;
  setText('kpi-netRevenue', money(m.netRevenue));
  setText('kpi-partnerPayout', money(m.partnerPayout));
  setText('kpi-blendedRate', `blended ${percent(m.blendedRate)} rev-share`);
  setText('kpi-marketingValue', money(m.marketingValue));
  setText('kpi-totalValue', money(m.totalValue));
  setText('total-callout-value', money(m.totalValue));
  // Paying Customers box + subjective exposure callout
  setText('kpi-payingCustomers', (m.payingCustomers ?? 0).toLocaleString());
  setText('kpi-exposure', `${(m.exposureViews ?? 0).toLocaleString()}+ impressions reached`);
}

/** Subjective "X customers / X views / X reviews" callouts in the Marketing section. */
export function paintValueCallouts(results) {
  const host = document.getElementById('value-callouts');
  if (!host) return;
  const m = results.metrics;
  const n = (x) => (x ?? 0).toLocaleString();
  host.innerHTML = `
    <div class="value-callout"><b>${n(m.payingCustomers)}</b><span>new paying customers</span></div>
    <div class="value-callout"><b>${n(m.exposureViews)}+</b><span>brand impressions reached</span></div>
    <div class="value-callout"><b>${n(m.payingCustomers)}</b><span>potential 5-star reviews</span></div>`;
}

/** Render the Cost Recovery summary: net cash to partner + coverage narrative. */
export function paintCostRecovery(results) {
  const host = document.getElementById('cost-recovery');
  if (!host) return;
  const m = results.metrics;
  const months = results.series.costOverTime.length;
  const netClass = m.netCashToPartner >= 0 ? 'pos' : 'neg';
  const note = m.fullyCovered
    ? `Your payout covers all ${months} months of credit costs, with ${money(m.netCashToPartner)} to spare.`
    : `Your payout covers ~${m.coveredMonths} of ${months} months of credit costs before cumulative cost catches up.`;
  host.innerHTML = `
    <h3 class="cost-recovery__title">Cost Recovery</h3>
    <p class="cost-recovery__label">Net cash to partner</p>
    <p class="cost-recovery__value cost-recovery__value--${netClass}">${money(m.netCashToPartner)}</p>
    <p class="cost-recovery__sub">payout ${money(m.partnerPayout)} − 12-mo costs ${money(m.cumulativeCost12)} (aggressive usage)</p>
    <p class="cost-recovery__note">${note}</p>`;
}

/** Render the 6 marketing channel detail cards (data-driven from results). */
export function paintChannelCards(results, benchmarks) {
  const host = document.getElementById('channel-cards');
  if (!host) return;
  const defs = benchmarks.marketingChannels;
  const customers = results.metrics.totalCustomers ?? 0;
  host.innerHTML = results.comparisons.marketingChannels.map((c) => {
    const copy = (defs[c.key]?.copy ?? '').replace(/\{customers\}/g, customers.toLocaleString());
    return `
    <article class="channel-card">
      <p class="channel-card__label">${defs[c.key]?.label ?? c.label}</p>
      <p class="channel-card__copy">${copy}</p>
      <p class="channel-card__value">${money(c.value)}</p>
    </article>`;
  }).join('');
}

/** Render the read-only assumptions list (rev-share tiers + marketing rates). */
export function paintAssumptions(benchmarks) {
  const host = document.getElementById('assumptions-list');
  if (!host) return;
  const tiers = benchmarks.revShareTiers.map((t) =>
    `<li><span>Tier ${t.tier} rev-share</span><b>${(t.rate * 100)}%</b></li>`).join('');
  const chans = Object.values(benchmarks.marketingChannels).map((c) =>
    `<li><span>${c.label}</span><b>${money(c.defaultValue)}</b></li>`).join('');
  host.innerHTML = tiers + chans;
}

/**
 * Wire form via event delegation so dynamically-rendered tier inputs + marketing
 * toggles are covered without re-binding. handlers: { onChange, onReset, onTierCount }.
 */
export function bindInputs(schema, handlers, debounceMs = 250) {
  const form = document.getElementById('bva-form');
  if (!form) { console.warn('[BVA] #bva-form not found — inputs not bound'); return; }
  const debounced = debounce(handlers.onChange, debounceMs);
  form.addEventListener('input', debounced);
  form.addEventListener('change', debounced);
  document.getElementById('tier-count')?.addEventListener('change', handlers.onTierCount);
  document.getElementById('btn-calculate')?.addEventListener('click', handlers.onChange);
  document.getElementById('btn-reset')?.addEventListener('click', handlers.onReset);
}

/** Render N horizontal tier columns (AppSumo-style: header → price → units). */
export function renderTierTable(tierCount) {
  const host = document.getElementById('tier-table');
  if (!host) return;
  const n = Math.max(1, Math.min(5, Number(tierCount) || 3));
  host.style.setProperty('--tier-cols', n);
  let html = '';
  for (let i = 1; i <= n; i++) {
    html += `
      <div class="tier-col">
        <div class="tier-col__head">Tier ${i}</div>
        <label class="tier-col__field">Price ($)
          <input type="number" data-field="tier${i}Price" min="0" step="0.01" inputmode="decimal" />
        </label>
        <label class="tier-col__field">Units
          <input type="number" data-field="tier${i}Units" min="0" step="1" inputmode="numeric" />
        </label>
      </div>`;
  }
  host.innerHTML = html;
}

/** Read current tier-table input values (to preserve across a re-render). */
export function readTierValues() {
  const out = {};
  document.querySelectorAll('#tier-table [data-field]').forEach((el) => { out[el.getAttribute('data-field')] = el.value; });
  return out;
}

/** Render marketing channel toggles. `enabled` is a { key: bool } map. */
export function renderMarketingToggles(channelDefs, enabled = {}) {
  const host = document.getElementById('marketing-toggles');
  if (!host) return;
  host.innerHTML = Object.entries(channelDefs).map(([key, c]) => `
    <label class="mkt-toggle">
      <input type="checkbox" class="mkt-check" data-mkt="${key}" ${enabled[key] !== false ? 'checked' : ''} />
      <span>${c.label}</span>
    </label>`).join('');
}

/** Read marketing toggle state → { key: bool } for the calc engine. */
export function readMarketing() {
  const out = {};
  document.querySelectorAll('.mkt-check').forEach((el) => { out[el.getAttribute('data-mkt')] = el.checked; });
  return out;
}

/** Populate input fields from a flat values map (presets / schema defaults). */
export function fillInputs(values) {
  document.querySelectorAll('[data-field]').forEach((el) => {
    const k = el.getAttribute('data-field');
    if (values[k] !== undefined) {
      // refundRate is stored fractional (0.15) but shown as percent points (15)
      el.value = k === 'refundRate' ? +(values[k] * 100).toFixed(4) : values[k];
    }
  });
}

/** Populate the preset <select> from a list of {value, label}. */
export function fillPresetOptions(options) {
  const sel = document.getElementById('preset-select');
  sel.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
}

/** Show field-level validation errors; returns true if any errors present. */
export function showErrors(errors) {
  document.querySelectorAll('[data-field]').forEach((el) => {
    const k = el.getAttribute('data-field');
    el.classList.toggle('is-invalid', Boolean(errors[k]));
    let msg = el.parentElement.querySelector('.field-error');
    if (errors[k]) {
      if (!msg) { msg = document.createElement('small'); msg.className = 'field-error'; el.parentElement.appendChild(msg); }
      msg.textContent = errors[k];
    } else if (msg) { msg.remove(); }
  });
  const has = Object.keys(errors).length > 0;
  setStatus(has ? `${Object.keys(errors).length} field(s) need attention.` : 'Calculated.', has ? 'error' : 'ok');
  return has;
}

export function setStatus(text, kind = '') {
  const el = document.getElementById('form-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'form-status' + (kind ? ` is-${kind}` : '');
}

// --- helpers ---
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
