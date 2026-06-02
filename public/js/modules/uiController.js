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

/** Paint the four headline KPI cards + the total callout. */
export function paintKpis(results) {
  const m = results.metrics;
  setText('kpi-netRevenue', money(m.netRevenue));
  setText('kpi-partnerPayout', money(m.partnerPayout));
  setText('kpi-blendedRate', `blended ${percent(m.blendedRate)}`);
  setText('kpi-marketingValue', money(m.marketingValue));
  setText('kpi-totalValue', money(m.totalValue));
  setText('total-callout-value', money(m.totalValue));
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
  host.innerHTML = results.comparisons.marketingChannels.map((c) => `
    <article class="channel-card">
      <p class="channel-card__label">${defs[c.key]?.label ?? c.label}</p>
      <p class="channel-card__copy">${defs[c.key]?.copy ?? ''}</p>
      <p class="channel-card__value">${money(c.value)}</p>
    </article>`).join('');
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
 * Wire form fields, preset selector, and buttons. Calls onChange (debounced) on input.
 *  - schema: input-schema.json (for defaults + validation messages)
 *  - handlers: { onChange, onPreset, onReset }
 */
export function bindInputs(schema, handlers, debounceMs = 250) {
  const form = document.getElementById('bva-form');
  const debounced = debounce(handlers.onChange, debounceMs);
  form.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', debounced);
  });
  document.getElementById('btn-calculate').addEventListener('click', handlers.onChange);
  document.getElementById('btn-reset').addEventListener('click', handlers.onReset);
  document.getElementById('preset-select').addEventListener('change', (e) => handlers.onPreset(e.target.value));
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
