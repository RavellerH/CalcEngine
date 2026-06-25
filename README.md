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

## PCB Quotation (JLCPCB/EasyEDA + Google Sheets pricing DB)

The "PCB Quotation" button in the header opens a workflow for client quotations on
hardware sourced via EasyEDA design / JLCPCB fabrication, following the rule
**sell price = capital cost × multiplier (default 2x) + transport**:

1. **Pricing database** — no Sheet yet? Click "Download starter template" for a
   ready-made `.xlsx` with the expected columns
   (`id, name, source, category, currency, capital_cost, min_multiplier, transport_cost, sell_price, notes`)
   and a live `sell_price` formula — import it into a new Google Sheet to bootstrap
   the database, then share it with whoever maintains pricing.

   Two ways to connect the app to that Sheet:
   - **Apps Script Web App (recommended, read + write)** — deploy
     [`tools/apps-script/Code.gs`](tools/apps-script/Code.gs) as a Web App bound to your
     Sheet: open the Sheet, `Extensions > Apps Script`, paste in the file's contents,
     set `SHARED_SECRET` to a value only you and whoever maintains pricing know, then
     `Deploy > New deployment` → type **Web app**, Execute as **Me**, who has access
     **Anyone with the link**. Paste the resulting URL and your secret into the modal's
     "Apps Script Web App URL"/"Shared secret" fields and click "Connect". This is a
     small server-side proxy bound to the Sheet — the app never holds a Google login,
     but rows you push land in the Sheet as live formulas (`Range.setFormula()`),
     auditable and editable by hand just like everything else in the Sheet.
   - **Published-CSV link (fallback, read-only, no setup)** — `File > Share > Publish
     to web`, format **CSV**, paste that link into "Fetch pricing DB". No deployment
     needed, but pricing updates have to be pulled in manually and there's no write-back.
2. **Upload a BOM or JLCPCB quote** — CSV/Excel BOM exports (EasyEDA/JLCPCB) or a
   JLCPCB quote/order PDF (best-effort text parsing; always review the parsed rows).
   Unpriced BOM rows (e.g. EasyEDA BOMs have no cost) are matched against the fetched
   pricing DB by name/part number.
3. **Review & compute** — set a transport total for the batch (allocated across rows
   proportional to capital cost) and the minimum multiplier, then either:
   - **Add to Hardware pillar** to fold the quotation straight into the current
     simulation (so the existing PDF/Excel client-quote export picks it up),
   - **Push to Sheet via Apps Script** to append the priced rows directly to your
     pricing Sheet (shown once an Apps Script URL is connected), or
   - **Download Sheet-ready .xlsx** / **Copy formulas for Google Sheets** as a manual
     download/paste fallback that needs no Apps Script deployment at all.

   In every write path the Sell Price column ends up as a live formula
   (`capital_cost * min_multiplier + transport_cost`), not a static number, so it stays
   correct in the Sheet if a capital cost changes later.

This keeps the app's no-backend architecture intact: it never holds Google credentials,
and the Apps Script Web App (when used) is a small proxy *you* deploy and control inside
your own Google account, gated by a shared secret you choose — not a hosted backend
the app's authors operate.

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
src/js/pcb_pricing.js    Google Sheets pricing DB fetch/push, BOM/quote parsing, quotation export
src/js/ui-bindings.js    Alpine.js root component wiring state to the DOM
tools/apps-script/       Code.gs — Apps Script Web App bridge to deploy on your own Sheet
data/                    Static catalogs and regulatory presets
assets/                  Logo and favicon
```
