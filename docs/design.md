# Deviota CalcEngine – Architectural Design

## 1. System Architecture & Tech Stack

### 1.1 High-Level Architecture

Deviota CalcEngine is a 100% client-side, single-page web application served as static assets via GitHub Pages under the Deviota organization. All computation, state management, and document exports (PDF/Excel) are executed in the browser, with no backend services, to ensure portability and ease of deployment.

Key characteristics:

- **Hosting**: GitHub Pages (static hosting, served from `main` or `gh-pages` branch).
- **Application type**: SPA-style dashboard (single HTML entry point, dynamic views via JavaScript).
- **Data source**:
  - Base component price list loaded via `fetch('/data/prices.json')`.
  - Optional static reference tables (e.g. INKINDO baseline rates, SBM-based caps) also stored as JSON under `/data/` for offline use.
- **State**:
  - In-memory state object as single source of truth.
  - Optional persistence in `localStorage` (for quick restore of last simulation).
  - Explicit import/export to `.json` for long-term storage and sharing.
- **Security**:
  - No secrets or private APIs; only optional public FX API for USD→IDR.
  - All regulatory tables stored locally (no external protected documents embedded).

### 1.2 Tech Stack Choice

**Core stack**

- HTML5 + Tailwind CSS:
  - Tailwind for rapid, consistent utility-based styling and responsive layout.
  - Custom Deviota color palette defined via Tailwind config / utility classes.
- JavaScript:
  - Vanilla JS for core logic, state management, and calculations.
  - Alpine.js for declarative UI bindings (component state, conditionals, loops) without heavy frameworks.
- Build tooling:
  - Zero-build approach: CDN versions of Tailwind (play build) and Alpine.js for fastest onboarding.
  - Optional: later move to PostCSS + Tailwind CLI if needed.

**Export libraries**

- PDF export: `pdfmake` (declarative document definition for deterministic layout and branding).
- Excel export: SheetJS (`xlsx`) for multi-sheet workbook generation and client-side download.

### 1.3 Currency/Tax Regulatory Anchors

- **Default PPN configuration**:
  - Indonesian PPN (VAT) standard effective rate: default 11% for most taxable goods/services (12% statutory rate applied to an 11/12 base for non-luxury items).
  - PPN rate is configurable (default 11%, switchable to 12% or other values if policy changes).
- **HR regulatory anchors**:
  - INKINDO Billing Rate: baseline remuneration per Person-Month by qualification (Ahli Muda/Madya/Utama), education (S1/S2/S3), and experience bands, indexed by province coefficient.
  - Kemenkeu SBM (Standar Biaya Masukan): secondary reference for government-standard travel, honorarium, and related costs; values are upper caps under the relevant PMK (e.g. PMK 32/2025 for TA 2026).

The app does not embed copyrighted tables; instead it provides configurable fields and "regulatory presets" keyed to reference IDs (e.g. `INK-2024-AHLI-MUDA`, `SBM-2026-TRAVEL-DN-A`) that the organization can maintain in separate JSON files.

## 2. UI/UX Components & Layout

### 2.1 Global Layout

**Desktop:**

- Top header bar: Deviota logo + title (left); New Simulation / Load JSON / Save JSON / Export PDF / Export Excel / theme toggle (right).
- Left sidebar (Config Panel): project/client details, currency & FX configuration, PPN configuration, HR regulatory presets and coefficients.
- Main content area: tabs for the 4 cost pillars (Hardware, Software, Installation, Human Resources), each with a CRUD table and inline calculations.
- Right summary panel: live pillar-wise totals, PPN, grand total, CAPEX vs OPEX view, key ratios.

**Mobile:**

- Header stays at top; sidebar collapses into a slide-over panel.
- Pillar tabs become horizontal scrollable chips.
- Summary becomes a collapsible section / dedicated tab.

### 2.2 Key UI Components

1. **Header Bar** – logo/title, New/Load/Save/Export actions, unsaved-changes indicator.
2. **Global Configuration Sidebar** – Project Info, Currency & FX, Tax (PPN), HR Regulatory Presets.
3. **Pillar Tables** – Hardware, Software, Installation, Human Resources, each with line items, qty, unit price, margin, PPN toggle, subtotal, and row actions (duplicate/delete).
4. **Live Summary Dashboard** – pillar totals, PPN, grand total, CAPEX/OPEX, printable quote preview CTA.

## 3. Data Schema Definitions

### 3.1 `/data/prices.json`

Static catalog of commonly used components, modules, licenses, and HR templates used to seed table rows. Each entry has `id`, `pillar`, `name`, `description`, `source`, `category`, `unit`, `currency`, `unit_cost`, `default_margin_pct`, `taxable_ppn`, and pillar-specific `metadata`.

### 3.2 Simulation Export JSON

Round-trip snapshot of a simulation: `version`, `meta`, `project`, `config` (display currency, FX, tax, HR presets), `pillars` (hardware/software/installation/human_resources line items), and `cached_totals`.

See `data/prices.json` and the `import_export.js` module for the canonical shapes used by the app.

## 4. Mathematical Formulation

All numeric fields are floating point; currency values are rounded to 2 decimals for display.

### 4.1 Currency Conversion

Given native currency `c`, display currency `d`, and exchange rate `r = USD→IDR`:

- If `c == d`: `price_display = price_native`
- USD → IDR: `price_IDR = price_USD * r`
- IDR → USD: `price_USD = price_IDR / r`

All row totals are computed in display currency; native values are converted before aggregation.

### 4.2 Row Subtotals and Margins (Hardware / Software / Installation)

For quantity `q`, base unit cost `p_base` (display currency), margin fraction `m`:

```
sell_price = p_base * (1 + m)
row_subtotal = q * sell_price
```

Annual hardware maintenance, with CAPEX subtotal `S_capex` and yearly maintenance fraction `α`:

```
maintenance_per_year = S_capex * α
maintenance_n_years  = n * maintenance_per_year
```

### 4.3 Software Licensing

- One-time setup: `S_setup = q * sell_price`
- Subscription, with monthly cost `p_month`, duration `t` months, seats `s`: `S_sub = p_month * t * s`
- Maintenance/support as a fraction `β` of license CAPEX: `S_maint = S_license_capex * β`

### 4.4 Installation Costs

`row_subtotal = q * sell_price`, with optional breakdown columns (travel days × daily rate + materials) feeding into the same aggregated subtotal.

### 4.5 Human Resources (INKINDO + Regional Coefficient)

Given baseline Person-Month rate `R_base`, regional coefficient `k_region`, working days per month `D_month`:

```
R_month = R_base * k_region
R_day   = R_month / D_month
```

Row subtotal:

- Person-Month basis: `S_HR = T_months * R_month`
- Person-Day basis: `S_HR = T_days * R_day`
- Manual override: use `R_custom` in place of `R_month` / `R_day`

### 4.6 Government Standards (SBM Caps)

Given user-proposed unit cost `C_user` and SBM cap `C_sbm_max` for the category/location, when `enforce_sbm_caps` is true:

```
C_effective = min(C_user, C_sbm_max)
row_subtotal = q * C_effective
```

When enforcement is off, `C_effective = C_user`, with a UI warning if `C_user > C_sbm_max`.

### 4.7 Tax (PPN) Aggregation

For the set `T` of rows with `taxable_ppn = true`, and PPN rate `τ` (default 0.11):

```
taxable_base = sum(row_subtotal for row in T)
ppn_total    = τ * taxable_base
```

Advanced DPP mode (statutory 12% applied to a reduced base factor `f_dpp`, default `11/12`):

```
ppn_total = 0.12 * f_dpp * taxable_base
```

### 4.8 Pillar Totals, CAPEX/OPEX, Grand Total

```
S_HW, S_SW, S_INST, S_HR = sum of each pillar's row subtotals

grand_total_before_tax = S_HW + S_SW + S_INST + S_HR
grand_total_after_tax  = grand_total_before_tax + ppn_total

CAPEX = S_HW + S_SW_setup + S_INST
OPEX  = S_SW_sub + S_SW_maint + S_HR
```

## 5. Repository Layout & Implementation Roadmap

### 5.1 Repository Directory Structure

```
/
├─ index.html
├─ docs/
│  └─ design.md
├─ assets/
│  ├─ logo-deviota.svg
│  └─ favicon.svg
├─ data/
│  ├─ prices.json
│  ├─ inkindo-presets.json
│  └─ sbm-presets.json
├─ src/
│  ├─ css/
│  │  └─ tailwind.css
│  └─ js/
│     ├─ state.js
│     ├─ config.js
│     ├─ calculations.js
│     ├─ ui-bindings.js
│     ├─ import_export.js
│     ├─ export_pdf.js
│     └─ export_excel.js
└─ .github/
   └─ workflows/
      └─ github-pages.yml
```

### 5.2 Implementation Roadmap

1. **Scaffolding & Infrastructure** – base `index.html`, GitHub Pages workflow, data stubs.
2. **Core State & Calculation Engine** – `state.js` (appState + mutations), `calculations.js` (pure formula functions per section 4).
3. **UI & UX** – Alpine.js bindings for sidebar, pillar tables, catalog modal.
4. **Import/Export & Persistence** – JSON save/load, localStorage auto-save, FX API fetcher.
5. **PDF & Excel Export** – `export_pdf.js` (pdfmake quote layout), `export_excel.js` (SheetJS multi-sheet workbook).
6. **Polish, Validation, Theming** – inline validation, SBM/INKINDO deviation warnings, Deviota branding, responsive refinement.

This document defines the architectural blueprint, data models, formulas, and implementation steps for Deviota CalcEngine.
