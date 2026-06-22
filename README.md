# Deviota CalcEngine

A 100% client-side cost-simulation tool for Hardware, Software, Installation, and Human Resources cost pillars, with PPN tax handling, INKINDO/SBM-aware HR rates, and PDF/Excel export. No backend — runs entirely in the browser as a static site.

See [`docs/design.md`](docs/design.md) for the full architectural design, data schemas, and formulas.

## Running locally

No build step is required. Serve the repository root with any static file server, e.g.:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

The included GitHub Actions workflow (`.github/workflows/github-pages.yml`) deploys the repository root to GitHub Pages on every push to `main`. Enable Pages in the repository settings with source set to "GitHub Actions".

## Customizing regulatory presets

- `data/prices.json` — seed catalog of hardware/software/installation/HR line items used by the "Add from catalog" modal.
- `data/inkindo-presets.json` — INKINDO regional index presets. Baseline Person-Month rates per grade/education/experience band are **not** embedded (for licensing reasons) — populate them in your own catalog entries or extend this file internally.
- `data/sbm-presets.json` — Kemenkeu SBM category caps. Cap values are `null` by default; populate `cap_idr` per category from the current PMK to enable SBM cap enforcement.

## Project structure

```
index.html              Single-page app entry point
src/js/config.js         Constants, enums, default state factories
src/js/calculations.js   Pure calculation engine (see docs/design.md section 4)
src/js/state.js          appState shape + CRUD mutation helpers
src/js/import_export.js  JSON save/load, localStorage auto-save, FX fetch
src/js/export_pdf.js     pdfmake-based quote PDF export
src/js/export_excel.js   SheetJS-based multi-sheet workbook export
src/js/ui-bindings.js    Alpine.js root component wiring state to the DOM
data/                    Static catalogs and regulatory presets
assets/                  Logo and favicon
```
