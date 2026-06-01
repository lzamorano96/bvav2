// dataIngestion.js — Data Ingestion module (M1).
//
// ONLY module that calls fetch(). Responsibilities:
//   1. loadData()           — fetch + parse config/benchmarks/schema JSON
//   2. loadPreset(name)     — fetch a scenario preset
//   3. validate(values, sc) — PURE: coerce types + check required/min/max -> {inputs, errors}
//   4. readInputs(sc, root) — read DOM [data-field] elements, then validate
//
// Contains NO business math and NO chart code. `validate` is pure and DOM-free so it
// is unit-testable headlessly (see scripts run at M1 verification).

const DATA_BASE = 'data';

/** Fetch and parse the three core JSON files in parallel. */
export async function loadData(base = DATA_BASE) {
  const [config, benchmarks, schema] = await Promise.all([
    fetchJson(`${base}/config.json`),
    fetchJson(`${base}/benchmarks.json`),
    fetchJson(`${base}/input-schema.json`),
  ]);
  return { config, benchmarks, schema };
}

/** Fetch a named preset from data/presets/<name>.json. */
export async function loadPreset(name, base = DATA_BASE) {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid preset name: ${name}`);
  return fetchJson(`${base}/presets/${name}.json`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  return res.json();
}

/**
 * Validate a flat values map against schema.fields.
 * PURE — no DOM, no fetch. Returns { inputs, errors }.
 *   inputs: coerced values for every field that passed
 *   errors: { <field>: "<message>" } for every field that failed
 * Coercion: percent fields accept "15" / "15%" / 0.15; numbers strip $ and commas.
 */
export function validate(values, schema) {
  const fields = (schema && schema.fields) || {};
  const inputs = {};
  const errors = {};

  for (const [name, rule] of Object.entries(fields)) {
    const raw = values[name];
    const present = raw !== undefined && raw !== null && String(raw).trim() !== '';

    if (!present) {
      if (rule.required && rule.default === undefined) {
        errors[name] = 'Required.';
      } else {
        inputs[name] = rule.default;
      }
      continue;
    }

    const { value, error } = coerce(raw, rule);
    if (error) { errors[name] = error; continue; }

    const range = checkRange(value, rule);
    if (range) { errors[name] = range; continue; }

    inputs[name] = value;
  }

  return { inputs, errors };
}

function coerce(raw, rule) {
  const s = String(raw).trim();
  switch (rule.type) {
    case 'integer': {
      const n = Number(s.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: 'Must be a number.' };
      if (!Number.isInteger(n)) return { error: 'Must be a whole number.' };
      return { value: n };
    }
    case 'number': {
      const n = Number(s.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: 'Must be a number.' };
      return { value: n };
    }
    case 'percent': {
      const hadSign = s.includes('%');
      const n = Number(s.replace(/[%,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: 'Must be a percentage.' };
      // "15%" or "15" -> 0.15 ; a bare 0–1 value is treated as already-fractional
      const value = hadSign || n > 1 ? n / 100 : n;
      return { value };
    }
    default:
      return { value: s };
  }
}

function checkRange(value, rule) {
  // Percent fields store fractional values (0.15) but users think in percent (15%),
  // so express range limits in percent for a clear message.
  const fmt = (n) => (rule.type === 'percent' ? `${+(n * 100).toFixed(2)}%` : `${n}`);
  if (rule.min !== undefined && value < rule.min) return `Must be ≥ ${fmt(rule.min)}.`;
  if (rule.max !== undefined && value > rule.max) return `Must be ≤ ${fmt(rule.max)}.`;
  return null;
}

/** Read DOM inputs marked with [data-field="<name>"], then validate (M3 wires the DOM). */
export function readInputs(schema, root = document) {
  const values = {};
  root.querySelectorAll('[data-field]').forEach((el) => {
    values[el.getAttribute('data-field')] = el.value;
  });
  return validate(values, schema);
}
