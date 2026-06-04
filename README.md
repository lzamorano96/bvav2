# Business Value Assessment Calculator

Partner-facing calculator that quantifies total AppSumo partnership value:
net campaign revenue, partner payout, credit costs over 12 months, and layered
marketing value — summed into one headline number. Static site, deploys to
Firebase Hosting.

## Stack
- Vanilla HTML / CSS / JS (no bundler)
- [Chart.js 4.x](https://www.chartjs.org/) (MIT) — vendored in `public/js/lib/`
- JSON config / benchmarks / presets in `public/data/`

## Structure
```
public/        Firebase deploy target (the only published dir)
  index.html
  css/         reset · theme · layout · components
  js/          main.js + modules/ (ingestion, calc, charts, ui, export) + lib/
  data/        config · benchmarks · input-schema · presets/
docs/          plan, wireframe, data-flow, data-dictionary (NOT deployed)
design/        visual artifacts (NOT deployed)
firebase.json  hosting config (publishes public/ only)
.firebaserc    Firebase project binding
```

## Run locally
Any static server, e.g.:
```
cd public
python -m http.server 8000   # -> http://localhost:8000
```
Or `firebase emulators:start --only hosting`.

## Deploy (M6)
1. Vendor Chart.js into `public/js/lib/chart.umd.min.js`.
2. Set your project id in `.firebaserc` (or `firebase use --add`).
3. `firebase deploy --only hosting`.

## Status
**v1 — live.** Deployed to Firebase Hosting (`bva-appsumo`). Per-license-tier sales
model, dual-scenario credit cost, marketing value, and AppSumo brand styling complete.
The pre-restyle look is preserved under the git tag `styling-v1-pre-appsumo`.

## Author / Maintainer
Built and maintained by **Luis Zamorano**.
