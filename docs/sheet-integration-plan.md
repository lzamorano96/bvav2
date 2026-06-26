# BVA Calculator ↔ Deal-Structure Sheet — Implementation Plan
_Generated from an orchestrated design + adversarial-review pass, 2026-06-23._

## End-to-end flow
After a partner call, the BDM fills the deal-structure Google Sheet, then clicks a **"BVA" menu → Generate Links** button (a container-bound Apps Script running as Luis). The script reads a hidden machine-readable tab, shows a confirmation preview, and on confirm POSTs one normalized deal record to a Cloud Function that upserts it to Firestore on the existing `bva-appsumo` project. It returns two links: an **internal** `?deal=<slug>` URL (full economics + per-tier credit cost, behind Google sign-in + Firestore rules) and a **partner** `#hash` URL (partner-safe fields only). The calculator renders one stored record in two modes — internal (everything) or partner (generic, credit-cost hidden) — and the existing PDF/share-link export becomes the partner artifact.

---

## ⚠️ Phase 0 — Stop the live leaks (do FIRST)
**Why first:** Two adversarial-review criticals are already shipping on `bva-as-v2.web.app` today. Every partner share-link and PDF carries internal credit economics. Small, unblocks everything.

**Tasks (`public/js/modules/exporter.js`):**
- Split `FIELDS` → `PARTNER_FIELDS` (tierCount, tier1-5 Units/Price, refundRate, partner) and `INTERNAL_FIELDS` (costPerCredit, monthlyCredits, upfrontCredits). Drop `activeUsers` from the hash (derived in calcEngine).
- `encodeStateToUrl` iterates `PARTNER_FIELDS` ONLY — structurally incapable of referencing economics.
- `decodeStateFromUrl` skips any `INTERNAL_FIELDS` key (defense-in-depth for old links).
- `buildPdfDoc(state, viewMode)` — in `'partner'` mode omit `chart-cost-over-time` and the "Net cash to partner" row. Default `'partner'`.
- New Node test asserting encoder output + partner PDF body contain none of the internal keys/strings.

**Gate:** tests pass; decode a live share link → no cost fields; partner PDF → no cost chart/net-cash row. Deploy. **Effort ~0.5 day.**

---

## Phase 1 — Per-tier credit model (engine + schema)
**Goal:** Credits become a per-tier structure value, with a legacy blended fallback so existing outputs stay byte-compatible.

- `public/data/input-schema.json`: add `tier{1-5}CreditsMonthly` + `tier{1-5}CreditsUpfront` (int ≥0, required:false, example defaults). Make global `monthlyCredits`/`upfrontCredits` the fallback.
- `public/js/modules/calcEngine.js`: `computeCostCurve` accepts `{tierCredits[], costPerCredit}` (tier-sums); legacy scalar call wraps as one-element array. `assess` switches to per-tier ONLY when per-tier fields present, else exact legacy 40%-blended path. Populate `results.series.creditCostByTier` ONLY when `config.viewMode==='internal'`.
- `public/js/modules/uiController.js`: per-column credit inputs rendered ONLY in internal view (not CSS-hidden). Add `paintCreditCostByTier`.
- **Conflict resolution (critical):** per-tier credit keys go into `INTERNAL_FIELDS`/Firestore record ONLY — NEVER the URL encoder. No `encodeInternalUrl`; internal state loads from Firestore via `?deal=`.

**Gate:** golden-snapshot test — no per-tier fields ⇒ output identical to pre-Phase-1; partner-mode `assess` has no `creditCostByTier`. **Effort ~1.5–2 days.**

---

## Phase 2 — Internal/Partner view split + Firebase Auth
**Goal:** One record, two renders; internal economics never reach partner DOM/URL/PDF.

- `public/js/main.js`: `getRoute()` (`?deal=` wins over `#hash`; `?deal=` is the sole internal trigger), `setView(mode)`. **Bare/cold load → PARTNER (safe-by-default).** Internal path awaits auth + Firestore fetch.
- `public/index.html`: `<body data-view="partner">`; lazy-load Firebase Web SDK (mirror `ensurePdfLibs`). `.internal-only` tags = defense-in-depth only.
- `public/css/components.css`: `body[data-view="partner"] .internal-only{display:none!important}` (cosmetic).
- `public/js/modules/firebaseClient.js` (new): init app; `signInWithGoogle()` (Workspace `hd` hint), `getCurrentUserEmail()`, `fetchDeal(slug)`. Lazy-loaded on internal path only.
- `public/js/modules/exporter.js`: `buildInternalRecord(state)`; PDF/share buttons pass `viewMode`.

**Gate:** bare URL → partner, zero credit inputs in DOM (inspect element), clean link/PDF. `?deal=test` → forces sign-in → internal renders per-tier credits. **Effort ~2–3 days.**

---

## Phase 3 — Firestore backend: rules + Cloud Function + library
**Goal:** Server-enforced storage/auth; the only write path; owner-scoped library; audit history.

- `firebase.json`: add `firestore` + `functions` (nodejs20). Hosting unchanged.
- `firestore.rules` (new): default-deny baseline in the same deploy. Read: `auth!=null && token.email_verified==true && token.email==resource.data.ownerEmail && isAllowed(email)` — ownership AND-combined independently of allowlist. ALL client writes to deals/sheetIndex/revisions denied (Admin SDK bypasses). No cross-owner list.
- `firestore.indexes.json` (new): composite `(ownerEmail ASC, status ASC, updatedAt DESC)`.
- `functions/index.js` (new): HTTPS `ingestDeal` — only write path. Constant-time secret compare + verify caller identity; slug resolved in a transaction keyed on `sheetIndex/{sheetId}` (idempotent, -2/-3 dedup only on genuine collisions). Writes `deals/{slug}` + `deals/{slug}/revisions/{n}` + `sheetIndex/{sheetId}`. Returns `{slug, internalUrl, partnerUrl, revision}`.
- `functions/validateDeal.js` (new): strict allowlist validator — bound every field; revShareBands rate 0–1 strictly monotonic non-overlapping `from<to`; reject unknown keys; cap payload size; 422 + field errors.
- `functions/slug.js` (new): `slugify()` + dedup.
- `public/js/modules/dealStore.js` (new): `loadDeal`, `listDeals` (owner-scoped); projection edits via a SECOND `onCall` callable that updates only `projections{}`+`computed{}` (deals stays client-write-denied).

**Gate:** emulator rules tests pass BEFORE enabling any allowlist: A can't read B; unverified-email rejected; non-allowlisted rejected; not-found == not-owned (no existence oracle); `ingestDeal` rejects malformed/oversized with 422; round-trip POST → `?deal=` loads. **Effort ~3–4 days.**

---

## Phase 4 — Apps Script parser + dual-URL handoff
**Parser decision (from feasibility review): NOT freeform prose parsing.** Ship a hidden **`BVA_DATA` tab** in the template with fixed cells / named ranges, populated by formulas (`=ProductTab!C5`) referencing the human cells. Script parses ONLY that tab — turning open-ended NLP into reading ~15 known clean cells. Freeform reading kept only as a best-effort pre-populator the BDM confirms. **Mandatory blocking confirmation preview** before any write.

- `Code.gs`: `onOpen()` builds BVA menu; HtmlService sidebar.
- `Parser.gs`: `parseBvaDataTab()` reconciles `getValues()`/`getDisplayValues()`; rejects non-numeric money cells loudly (never silent NaN).
- `RevShare.gs`: optional band block (record/internal view only; never partner hash).
- `Handoff.gs`: `buildInternalUrl(slug)`; `buildPartnerHash(record)` over `PARTNER_FIELDS` only (refundRate fractional; omit activeUsers; never per-tier credits/rev-share).
- `FirestoreClient.gs`: `upsertDeal(record)` → POST `ingestDeal` with secret header + identity token; `ownerEmail` from `Session.getActiveUser().getEmail()`.
- `Sidebar.html`: blocking preview; nothing writes until Confirm.
- `appsscript.json`: scopes `spreadsheets.currentonly`, `script.external_request`, `userinfo.email`; urlFetchWhitelist for the Function origin.

**Gate:** run against Sample A (3 tiers, no rev-share) and Sample B (4 tiers + rev-share + multiple blocks): preview correct, flags secondary block, forces active-block selection; confirm → Firestore record → internal link loads full record → partner link decodes to safe fields only. **Effort ~3–4 days.**

---

## Phase 5 — PandaDoc (parked)
Forward note only. Future: triggered from the **sheet** (not calculator) as a second export target off the same record, via `anthropic-skills:pandadoc-mcp-setup`. No design beyond this.

---

## Security decisions baked in
- **No internal data in partner links/PDF (structural):** encoder iterates `PARTNER_FIELDS`; PDF view-aware; per-tier credit inputs + `creditCostByTier` not rendered/not constructed in partner mode (DOM-hidden ≠ safe — `readInputs` harvests all `[data-field]`). CSS `.internal-only` is defense-in-depth only. Invariant test in the build.
- **Server-side enforcement:** Firestore rules are the boundary; ownership AND-combined independently of allowlist; default-deny; all client writes denied; identical not-found/not-owned denial.
- **Domain allowlist:** `@appsumo.com` widening is one `isAllowed()` edit, gated behind passing emulator denial tests; `email_verified` required.
- **Secret handling:** secret in Secret Manager + Apps Script Script Properties (never in code/cells); constant-time compare; two-secret rotation; `ownerEmail` bound to verified identity (not free payload); `ingestDeal` rate-limited + write-logged.
- **Idempotency/audit:** `sheetId` durable key (survives renames); each write snapshots immutable `revisions/{n}`.

## Open questions for Luis
1. **Projection-edit trigger:** auto-save on change, or explicit "Save to deal" button?
2. **Sheet rev-share override:** should Sample-B per-deal bands override `benchmarks.json` (25/30/40) in the internal view, or stay audit-only?
3. **Partner-link single credit value:** units-weighted average for the collapsed `monthlyCredits` (recommended) vs tier-1 vs most-common.
4. **Workspace identity:** confirm Luis always runs the sheet under his `@appsumo.com` Workspace account (else fall back to `getEffectiveUser`).

## Recommended first step
Execute Phase 0 today and deploy. Half a day, closes two live exfiltration channels, and establishes the `PARTNER_FIELDS`/`INTERNAL_FIELDS` split every later phase depends on.
