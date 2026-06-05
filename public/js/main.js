// main.js — App bootstrap & controller.
// Owns the single app-state object and routes data: ingest -> calc -> render.
// Holds NO business formulas and NO chart config.

import { loadData, readInputs } from './modules/dataIngestion.js';
import { assess } from './modules/calcEngine.js';
import * as ui from './modules/uiController.js';
import { renderAll } from './modules/chartRenderer.js';
import { initExport, decodeStateFromUrl, decodePartnerFromUrl, clearUrl } from './modules/exporter.js';

const state = { config: null, benchmarks: null, schema: null, inputs: null, results: null };

async function bootstrap() {
  try {
    Object.assign(state, await loadData());   // {config, benchmarks, schema}
  } catch (e) {
    console.error('[BVA] Failed to load calculator data', e);
    ui.setStatus('Could not load calculator data — please refresh the page.', 'error');
    return;
  }

  ui.initFormat(state.config);
  ui.paintAssumptions(state.benchmarks);

  ui.bindInputs(state.schema, {
    onChange: recalc,
    onReset: () => applyDefaults(),
  });

  initExport(() => state);

  // Restore partner name from a shared link, if present.
  const partner = decodePartnerFromUrl();
  if (partner) document.getElementById('partner-input').value = partner;

  // Restore from a shared URL if present; otherwise open on the default scenario.
  const fromUrl = decodeStateFromUrl();
  if (fromUrl) {
    ui.fillInputs(fromUrl);
    recalc();
  } else {
    applyDefaults();
  }
  console.info('[BVA] M7 ready (polish).');
}

/** Read DOM -> validate -> calc -> paint. Charts wired at M4. */
function recalc() {
  const { inputs, errors } = readInputs(state.schema);
  const hasErrors = ui.showErrors(errors);
  if (hasErrors) return;

  state.inputs = inputs;
  state.results = assess(inputs, state.benchmarks, state.config);
  ui.paintKpis(state.results);
  ui.paintCostRecovery(state.results);
  ui.paintChannelCards(state.results, state.benchmarks);
  renderAll(state.results);
  // Note: the URL is NOT auto-synced on every change — a plain refresh of the
  // bare URL returns to defaults. Shareable links are produced on demand via
  // the Export → "Copy shareable link" button (encodeStateToUrl).
}

function applyDefaults() {
  const defaults = {};
  for (const [k, rule] of Object.entries(state.schema.fields)) {
    if (rule.default !== undefined) defaults[k] = rule.default;
  }
  clearUrl();          // drop any shared-scenario hash so Reset truly resets
  ui.fillInputs(defaults);
  recalc();
}

document.addEventListener('DOMContentLoaded', bootstrap);
