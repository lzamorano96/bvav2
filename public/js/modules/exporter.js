// exporter.js — Exporter module (M5).
// Produces partner-shareable artifacts:
//   1. Print / Save-as-PDF (uses print.css)
//   2. PNG snapshots of every chart canvas (via chartRenderer.snapshot)
//   3. Shareable URL hash that encodes inputs and restores on load
// Does NOT mutate calculation logic.

import { snapshot } from './chartRenderer.js';

// Fields encoded into the share link. refundRate stays fractional (0.15).
const FIELDS = ['tier1Units', 'tier1Price', 'tier2Units', 'tier2Price', 'tier3Units', 'tier3Price',
                'refundRate', 'activeUsers', 'costPerCredit', 'upfrontCredits', 'monthlyCredits'];

const CHART_FILES = [
  ['chart-waterfall', 'revenue-waterfall'],
  ['chart-payout-tiers', 'payout-tiers'],
  ['chart-cost-over-time', 'cost-over-time'],
  ['chart-channels-bar', 'marketing-channels'],
  ['chart-marketing-mix', 'marketing-mix'],
  ['chart-value-stack', 'total-value'],
];

/** Wire the Export button + popover menu. `getInputs` returns current validated inputs. */
export function initExport(getInputs) {
  const btn = document.getElementById('btn-export');
  if (!btn) return;
  const menu = buildMenu(btn);

  const sync = () => btn.setAttribute('aria-expanded', String(!menu.hidden));
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(menu); sync(); });
  document.addEventListener('click', () => { close(menu); sync(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(menu); sync(); btn.focus(); } });
  menu.addEventListener('click', (e) => e.stopPropagation());

  menu.querySelector('[data-action="print"]').addEventListener('click', () => { close(menu); window.print(); });
  menu.querySelector('[data-action="png"]').addEventListener('click', () => { close(menu); downloadCharts(); });
  menu.querySelector('[data-action="link"]').addEventListener('click', async (ev) => {
    const url = encodeStateToUrl(getInputs());
    await copyToClipboard(url);
    ev.target.textContent = 'Link copied ✓';
    setTimeout(() => { ev.target.textContent = 'Copy shareable link'; close(menu); }, 1200);
  });
}

/** Build a compact, reload-restorable URL from current inputs. */
export function encodeStateToUrl(inputs) {
  const p = new URLSearchParams();
  FIELDS.forEach((k) => { if (inputs && inputs[k] != null) p.set(k, inputs[k]); });
  const partner = document.getElementById('partner-input')?.value.trim();
  if (partner) p.set('partner', partner);
  return `${location.origin}${location.pathname}#${p.toString()}`;
}

/** Read the partner name from the URL hash (if a shared link carried one). */
export function decodePartnerFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  return new URLSearchParams(hash).get('partner');
}

/** Parse inputs from the URL hash; returns a values map or null if absent. */
export function decodeStateFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const out = {};
  let any = false;
  FIELDS.forEach((k) => { const v = p.get(k); if (v != null && v !== '') { out[k] = Number(v); any = true; } });
  return any ? out : null;
}

/** Keep the URL in sync with the current scenario (no history spam, no scroll jump). */
export function syncUrl(inputs) {
  history.replaceState(null, '', encodeStateToUrl(inputs));
}

/** Strip any shared-scenario hash so the URL returns to the bare app. */
export function clearUrl() {
  history.replaceState(null, '', `${location.origin}${location.pathname}`);
}

/** Download each chart canvas as a PNG. */
function downloadCharts() {
  CHART_FILES.forEach(([id, name]) => {
    const data = snapshot(id);
    if (!data) return;
    const a = document.createElement('a');
    a.href = data;
    a.download = `bva-${name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
  } catch (_) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}

// --- menu UI ---
function buildMenu(btn) {
  const menu = document.createElement('div');
  menu.className = 'export-menu';
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-action="print">Print / Save as PDF</button>
    <button type="button" data-action="png">Download chart images</button>
    <button type="button" data-action="link">Copy shareable link</button>`;
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(menu);
  return menu;
}
function toggle(menu) { menu.hidden = !menu.hidden; }
function close(menu) { menu.hidden = true; }
