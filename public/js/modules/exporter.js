// exporter.js — Exporter module.
//   1. High-fidelity PDF via jsPDF (+ autotable, embedded Barlow). Lazy-loaded.
//   2. PNG snapshots of every chart canvas.
//   3. Shareable URL hash that encodes inputs and restores on load.
// Does NOT mutate calculation logic. Chart pixels come from chartRenderer only.

import { snapshot, captureHiRes } from './chartRenderer.js';
import { PARTNER_FIELDS, isPartnerView, revenueCostRows } from './viewFields.js';

// SECURITY: the share-link encoder and the partner PDF must NEVER emit internal
// economics (the credit cost basis). The partner-safe field list + the view-aware
// PDF row builder live in viewFields.js (pure, unit-tested). This module only
// iterates PARTNER_FIELDS; it has no reference to the internal-only fields.

const CHART_FILES = [
  ['chart-waterfall', 'revenue-waterfall'], ['chart-payout-tiers', 'payout-tiers'],
  ['chart-cost-over-time', 'cost-over-time'], ['chart-channels-bar', 'marketing-channels'],
  ['chart-marketing-mix', 'marketing-mix'], ['chart-value-stack', 'total-value'],
];

// Charts embedded in the PDF, in report order, with their headings.
const PDF_CHARTS = [
  ['chart-waterfall', 'Revenue Breakdown'], ['chart-payout-tiers', 'Tiered Rev-Share Payout'],
  ['chart-cost-over-time', 'Credit Cost Over 12 Months'], ['chart-channels-bar', 'Marketing Value by Channel'],
  ['chart-marketing-mix', 'Marketing Value Mix'], ['chart-value-stack', 'Total Partnership Value'],
];

// Brand RGB (mirrors theme.css tokens)
const C = { bolt:[14,110,244], midnight:[27,27,27], grace:[67,77,89], border:[218,221,229] };
const usd = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format;

let getState = () => ({});

/** Wire the Export button + popover menu. `stateGetter` returns the live app state. */
export function initExport(stateGetter) {
  getState = stateGetter || getState;
  const btn = document.getElementById('btn-export');
  if (!btn) return;
  const menu = buildMenu(btn);
  const sync = () => btn.setAttribute('aria-expanded', String(!menu.hidden));

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(menu); sync(); });
  document.addEventListener('click', () => { close(menu); sync(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(menu); sync(); btn.focus(); } });
  menu.addEventListener('click', (e) => e.stopPropagation());

  menu.querySelector('[data-action="pdf"]').addEventListener('click', async () => {
    close(menu); sync();
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generating PDF…';
    try { await exportPdf(getState()); }
    catch (err) { console.error('[BVA] PDF export failed', err); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  menu.querySelector('[data-action="png"]').addEventListener('click', () => { close(menu); downloadCharts(); });
  menu.querySelector('[data-action="link"]').addEventListener('click', async (ev) => {
    await copyToClipboard(encodeStateToUrl(getState().inputs));
    ev.target.textContent = 'Link copied ✓';
    setTimeout(() => { ev.target.textContent = 'Copy shareable link'; close(menu); }, 1200);
  });
}

// ── PDF pipeline (lazy-loaded) ───────────────────────────────────────────────
let pdfLibs;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}
function ensurePdfLibs() {
  if (pdfLibs) return pdfLibs;
  pdfLibs = (async () => {
    if (!window.jspdf) await loadScript('js/lib/jspdf.umd.min.js');
    await loadScript('js/lib/jspdf.plugin.autotable.min.js');
    await loadScript('js/lib/barlow-fonts.js');
  })();
  return pdfLibs;
}

/** Build the jsPDF document for the current scenario. Exported for testing. */
export async function buildPdfDoc(state, viewMode = 'partner') {
  await ensurePdfLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const FONT = doc.getFontList().Barlow ? 'Barlow' : 'helvetica';   // graceful fallback
  const m = state.results.metrics, cmp = state.results.comparisons;
  const partner = (document.getElementById('partner-input')?.value || '').trim();

  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
  const M = 40, W = PW - M * 2, FOOT = 28;
  let y = M;
  const need = (h) => { if (y + h > PH - FOOT) { doc.addPage(); y = M; } };

  doc.setProperties({
    title: `Business Value Assessment${partner ? ' — ' + partner : ''}`,
    author: 'Luis Zamorano', subject: 'AppSumo partnership value assessment',
    creator: 'BVA Calculator', keywords: 'appsumo,partnership,roi,value',
  });

  // Title
  doc.setFont(FONT, 'bold').setFontSize(18).setTextColor(...C.midnight);
  doc.text('Business Value Assessment', M, y); y += 18;
  doc.setFont(FONT, 'normal').setFontSize(9).setTextColor(...C.grace);
  doc.text(`${partner || 'Partner'}  ·  bva-appsumo.web.app`, M, y); y += 14;

  // KPI summary (vector table)
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: 'grid',
    head: [['Net Revenue', 'Partner Payout', 'Marketing Value', 'Total Value']],
    body: [[usd(m.netRevenue), usd(m.partnerPayout), usd(m.marketingValue), usd(m.totalValue)]],
    styles: { font: FONT, halign: 'right', fontSize: 11, textColor: C.midnight },
    headStyles: { font: FONT, fillColor: C.bolt, textColor: [255,255,255], halign: 'right', fontSize: 8 },
  });
  y = doc.lastAutoTable.finalY + 18;

  // Section helper
  const heading = (txt) => { need(24); doc.setFont(FONT,'bold').setFontSize(13).setTextColor(...C.midnight); doc.text(txt, M, y); y += 12; };
  const placeChart = async (id, title) => {
    const cap = await captureHiRes(id, 3);
    if (!cap) return;
    let h = Math.min(W * cap.aspect, 250), w = h / cap.aspect, x = M + (W - w) / 2;
    need(16 + h);
    doc.setFont(FONT,'bold').setFontSize(10).setTextColor(...C.grace); doc.text(title, M, y); y += 8;
    doc.addImage(cap.url, 'PNG', x, y, w, h, undefined, 'FAST');
    cap.url = null;                       // release the dataURL before the next capture
    y += h + 16;
    await new Promise(requestAnimationFrame);   // yield: keep main-thread tasks short
  };

  // ACT 1 — Revenue (+ Cost, internal only)
  heading(isPartnerView(viewMode) ? 'Revenue' : 'Revenue & Cost');
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: 'plain',
    body: revenueCostRows(m, viewMode, usd),   // net-cash row is internal-only
    styles: { font: FONT, fontSize: 9, textColor: C.midnight }, columnStyles: { 1: { halign: 'right' } },
  });
  y = doc.lastAutoTable.finalY + 14;
  await placeChart('chart-waterfall', 'Revenue Breakdown');
  await placeChart('chart-payout-tiers', 'Tiered Rev-Share Payout');
  // Credit-cost curve exposes internal economics — partner PDF omits it entirely.
  if (!isPartnerView(viewMode)) await placeChart('chart-cost-over-time', 'Credit Cost Over 12 Months');

  // ACT 2 — Marketing Value
  heading('Marketing Value');
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: 'striped',
    head: [['Marketing Channel', 'Estimated Value']],
    body: cmp.marketingChannels.map((c) => [c.label, usd(c.value)]),
    foot: [['Total Marketing Value', usd(m.marketingValue)]],
    styles: { font: FONT, fontSize: 9, textColor: C.midnight }, columnStyles: { 1: { halign: 'right' } },
    headStyles: { font: FONT, fillColor: C.grace, textColor: [255,255,255] },
    footStyles: { font: FONT, fillColor: [245,245,249], textColor: C.midnight, halign: 'right' },
  });
  y = doc.lastAutoTable.finalY + 14;
  await placeChart('chart-channels-bar', 'Marketing Value by Channel');
  await placeChart('chart-marketing-mix', 'Marketing Value Mix');

  // ACT 3 — Total
  heading('Total Partnership Value');
  await placeChart('chart-value-stack', `Total: ${usd(m.totalValue)}`);

  // Footer with accurate page count
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i).setFont(FONT,'normal').setFontSize(8).setTextColor(...C.grace);
    doc.text('https://bva-appsumo.web.app', M, PH - 16);
    doc.text(`${i} / ${n}`, PW - M, PH - 16, { align: 'right' });
  }
  return doc;
}

/** Build + download the PDF. */
export async function exportPdf(state, viewMode = 'partner') {
  const doc = await buildPdfDoc(state, viewMode);
  const partner = (document.getElementById('partner-input')?.value || 'partner').trim();
  doc.save(`BVA-${(partner || 'partner').replace(/\W+/g, '-')}.pdf`);
}

// ── Shareable URL ────────────────────────────────────────────────────────────
export function encodeStateToUrl(inputs) {
  const p = new URLSearchParams();
  // PARTNER_FIELDS ONLY — this encoder must be structurally incapable of emitting
  // internal economics. Do not switch this back to a combined field list.
  PARTNER_FIELDS.forEach((k) => { if (inputs && inputs[k] != null) p.set(k, inputs[k]); });
  const partner = document.getElementById('partner-input')?.value.trim();
  if (partner) p.set('partner', partner);
  return `${location.origin}${location.pathname}#${p.toString()}`;
}
export function decodePartnerFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  return new URLSearchParams(hash).get('partner');
}
export function decodeStateFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const out = {};
  let any = false;
  // PARTNER_FIELDS only — any INTERNAL_FIELDS key in a legacy/leaky hash is ignored
  // (cost assumptions then fall back to schema defaults in validate()).
  PARTNER_FIELDS.forEach((k) => {
    const v = p.get(k);
    if (v == null || v === '') return;
    const n = Number(v);
    if (Number.isFinite(n)) { out[k] = n; any = true; }   // ignore malformed (NaN) params
  });
  return any ? out : null;
}
export function syncUrl(inputs) { history.replaceState(null, '', encodeStateToUrl(inputs)); }
export function clearUrl() { history.replaceState(null, '', `${location.origin}${location.pathname}`); }

// ── PNG snapshots ────────────────────────────────────────────────────────────
function downloadCharts() {
  CHART_FILES.forEach(([id, name]) => {
    const data = snapshot(id);
    if (!data) return;
    const a = document.createElement('a');
    a.href = data; a.download = `bva-${name}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  });
}

async function copyToClipboard(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; } }
  catch (_) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}

// ── menu UI ──────────────────────────────────────────────────────────────────
function buildMenu(btn) {
  const menu = document.createElement('div');
  menu.className = 'export-menu';
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-action="pdf">Download PDF (high-res)</button>
    <button type="button" data-action="png">Download chart images</button>
    <button type="button" data-action="link">Copy shareable link</button>`;
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(menu);
  return menu;
}
function toggle(menu) { menu.hidden = !menu.hidden; }
function close(menu) { menu.hidden = true; }
