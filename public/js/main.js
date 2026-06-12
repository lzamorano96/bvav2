// main.js — App bootstrap & controller.
// Owns the single app-state object and routes data: ingest -> calc -> render.
// Holds NO business formulas and NO chart config.

import { loadData, readInputs } from './modules/dataIngestion.js';
import { assess } from './modules/calcEngine.js';
import * as ui from './modules/uiController.js';
import { renderAll } from './modules/chartRenderer.js';
import { initExport, decodeStateFromUrl, decodePartnerFromUrl, clearUrl } from './modules/exporter.js';

const state = { config: null, benchmarks: null, schema: null, inputs: null, results: null };

/** Default marketing toggle state: everything on except channels flagged _placeholder. */
function defaultEnabled() {
  const out = {};
  for (const [key, c] of Object.entries(state.benchmarks.marketingChannels)) out[key] = !c._placeholder;
  return out;
}

async function bootstrap() {
  try {
    Object.assign(state, await loadData());   // {config, benchmarks, schema}
  } catch (e) {
    console.error('[BVA] Failed to load calculator data', e);
    ui.setStatus('Could not load calculator data — please refresh the page.', 'error');
    return;
  }

  ui.initFormat(state.config);
  ui.renderMarketingToggles(state.benchmarks.marketingChannels, defaultEnabled());
  ui.renderTierTable(3);   // initial columns; values filled by applyDefaults / URL restore

  ui.bindInputs(state.schema, {
    onChange: recalc,
    onReset: () => applyDefaults(),
    onTierCount: () => changeTierCount(),
  });

  initExport(() => state);

  // Restore partner name from a shared link, if present.
  const partner = decodePartnerFromUrl();
  if (partner) document.getElementById('partner-input').value = partner;

  // Restore from a shared URL if present; otherwise open on defaults.
  const fromUrl = decodeStateFromUrl();
  if (fromUrl) {
    if (fromUrl.tierCount) ui.renderTierTable(fromUrl.tierCount);
    ui.fillInputs(fromUrl);
    recalc();
  } else {
    applyDefaults();
  }
  console.info('[BVA] V2 ready.');
}

/** Read DOM -> validate -> calc -> paint. */
function recalc() {
  const { inputs, errors } = readInputs(state.schema);
  if (ui.showErrors(errors)) return;

  inputs.marketing = ui.readMarketing();   // merge channel-toggle state
  state.inputs = inputs;
  state.results = assess(inputs, state.benchmarks, state.config);
  ui.paintKpis(state.results);
  ui.paintValueCallouts(state.results);
  ui.paintCostRecovery(state.results);
  ui.paintChannelCards(state.results, state.benchmarks);
  renderAll(state.results);
}

/** Tier-count dropdown changed: re-render columns, preserve entered values, recalc. */
function changeTierCount() {
  const tc = Number(document.getElementById('tier-count').value) || 3;
  const preserved = ui.readTierValues();   // keep existing tier inputs
  ui.renderTierTable(tc);
  // Seed every column with schema defaults so newly-revealed tiers aren't empty,
  // then overlay whatever the user had already entered (typed values win).
  const tierDefaults = {};
  for (const [k, rule] of Object.entries(state.schema.fields)) {
    if (/^tier\d/.test(k) && rule.default !== undefined) tierDefaults[k] = rule.default;
  }
  ui.fillInputs(tierDefaults);
  for (const [k, v] of Object.entries(preserved)) if (v !== '') ui.fillInputs({ [k]: v });
  recalc();
}

function applyDefaults() {
  const defaults = {};
  for (const [k, rule] of Object.entries(state.schema.fields)) {
    if (rule.default !== undefined) defaults[k] = rule.default;
  }
  clearUrl();                                // drop any shared-scenario hash
  ui.renderTierTable(defaults.tierCount || 3);
  ui.renderMarketingToggles(state.benchmarks.marketingChannels, defaultEnabled());
  ui.fillInputs(defaults);
  recalc();
}

document.addEventListener('DOMContentLoaded', bootstrap);
