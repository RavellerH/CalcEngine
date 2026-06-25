/* Core calculation engine. Pure functions only — no DOM/state mutation.
   Implements the formulas defined in docs/design.md section 4. */

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Section 4.1 — currency conversion. */
function convertCurrency(amount, from, to, usdToIdr) {
  const a = Number(amount) || 0;
  if (from === to) return a;
  if (from === 'USD' && to === 'IDR') return a * usdToIdr;
  if (from === 'IDR' && to === 'USD') return a / usdToIdr;
  return a;
}

/** Section 4.2/4.4 — generic row subtotal for hardware/software/installation rows.
    Hardware rows may carry a per-unit `transport_cost`, added on top of the margin-based
    sell price (e.g. the "2x capital + transport" PCB quotation rule — margin_pct=1 gives 2x). */
function computeRowSubtotal(row, config) {
  const usdToIdr = config.fx.usd_to_idr;
  const display = config.display_currency;
  const qty = Number(row.quantity) || 0;
  const margin = Number(row.margin_pct) || 0;
  const baseInDisplay = convertCurrency(row.unit_cost, row.currency, display, usdToIdr);
  const transport = Number(row.transport_cost) || 0;
  const sellPrice = baseInDisplay * (1 + margin) + transport;
  return round2(qty * sellPrice);
}

/** Section 4.3 — software row subtotal, branching on row.type. */
function computeSoftwareRowSubtotal(row, config) {
  const usdToIdr = config.fx.usd_to_idr;
  const display = config.display_currency;
  const baseInDisplay = convertCurrency(row.unit_cost, row.currency, display, usdToIdr);
  const margin = Number(row.margin_pct) || 0;
  const sellPrice = baseInDisplay * (1 + margin);

  if (row.type === 'subscription') {
    const months = Number(row.period_months) || 0;
    const seats = Number(row.seats) || 1;
    return round2(sellPrice * months * seats);
  }
  // one_time and maintenance both follow qty * sell_price
  const qty = Number(row.quantity) || 0;
  return round2(qty * sellPrice);
}

/** Section 4.2 — hardware annual maintenance derived from CAPEX subtotal. */
function computeHardwareMaintenance(hardwareCapexSubtotal, maintenancePctPerYear, years = 1) {
  const perYear = (Number(hardwareCapexSubtotal) || 0) * (Number(maintenancePctPerYear) || 0);
  return round2(perYear * (Number(years) || 1));
}

/** Section 4.5 — human resources row subtotal with INKINDO regional coefficient. */
function computeHrRowSubtotal(row, config) {
  if (row.override_rate && row.custom_rate != null) {
    const customRate = Number(row.custom_rate) || 0;
    if (row.rate_basis === 'person_day') {
      return round2((Number(row.duration_days) || 0) * customRate);
    }
    return round2((Number(row.duration_months) || 0) * customRate);
  }

  const regionCoeff = Number(row.region_coefficient ?? config.hr.region_coefficient) || 1;
  const monthlyRate = (Number(row.rate_per_month) || 0) * regionCoeff;

  if (row.rate_basis === 'person_day') {
    const workingDays = Number(config.hr.working_days_per_month) || 22;
    const dailyRate = monthlyRate / workingDays;
    return round2((Number(row.duration_days) || 0) * dailyRate);
  }

  // person_month (also covers lump_sum where duration_months acts as a multiplier of 1)
  return round2((Number(row.duration_months) || 0) * monthlyRate);
}

/** Section 4.6 — SBM cap enforcement for a proposed unit cost. */
function applySbmCap(userUnitCost, sbmMaxUnitCost, enforceCaps) {
  const user = Number(userUnitCost) || 0;
  const cap = sbmMaxUnitCost == null ? null : Number(sbmMaxUnitCost);
  if (!enforceCaps || cap == null) return user;
  return Math.min(user, cap);
}

/** Computes subtotal for every row across all pillars, returning a flat map of rowId -> subtotal. */
function computeAllRowSubtotals(appState) {
  const { config, pillars } = appState;
  const subtotals = {};

  pillars.hardware.items.forEach((row) => {
    subtotals[row.id] = computeRowSubtotal(row, config);
  });
  pillars.software.items.forEach((row) => {
    subtotals[row.id] = computeSoftwareRowSubtotal(row, config);
  });
  pillars.installation.items.forEach((row) => {
    subtotals[row.id] = computeRowSubtotal(row, config);
  });
  pillars.human_resources.items.forEach((row) => {
    subtotals[row.id] = computeHrRowSubtotal(row, config);
  });

  return subtotals;
}

/** Section 4.8 — pillar totals. */
function computePillarTotals(appState) {
  const subtotals = computeAllRowSubtotals(appState);
  const { pillars } = appState;

  const sum = (pillar) =>
    round2(pillars[pillar].items.reduce((acc, row) => acc + (subtotals[row.id] || 0), 0));

  return {
    hardware: sum('hardware'),
    software: sum('software'),
    installation: sum('installation'),
    human_resources: sum('human_resources'),
    _subtotals: subtotals,
  };
}

/** Section 4.7 — PPN aggregation across all taxable rows. */
function computePpn(appState) {
  const { config, pillars } = appState;
  const subtotals = computeAllRowSubtotals(appState);

  if (!config.tax.ppn_enabled) {
    return { taxable_base: 0, ppn_total: 0 };
  }

  let taxableBase = 0;
  Object.values(pillars).forEach((pillar) => {
    pillar.items.forEach((row) => {
      if (row.taxable_ppn) {
        taxableBase += subtotals[row.id] || 0;
      }
    });
  });
  taxableBase = round2(taxableBase);

  let ppnTotal;
  if (config.tax.use_advanced_dpp) {
    ppnTotal = round2(0.12 * config.tax.dpp_factor * taxableBase);
  } else {
    ppnTotal = round2(config.tax.ppn_rate * taxableBase);
  }

  return { taxable_base: taxableBase, ppn_total: ppnTotal };
}

/** Section 4.8 — grand totals and CAPEX/OPEX breakdown. */
function computeGrandTotals(appState) {
  const pillarTotals = computePillarTotals(appState);
  const { taxable_base, ppn_total } = computePpn(appState);

  const grandBeforeTax = round2(
    pillarTotals.hardware + pillarTotals.software + pillarTotals.installation + pillarTotals.human_resources
  );
  const grandAfterTax = round2(grandBeforeTax + ppn_total);

  // CAPEX/OPEX split for software depends on row.type
  const swSetup = round2(
    appState.pillars.software.items
      .filter((r) => r.type !== 'subscription' && r.type !== 'maintenance')
      .reduce((acc, r) => acc + (pillarTotals._subtotals[r.id] || 0), 0)
  );
  const swSub = round2(
    appState.pillars.software.items
      .filter((r) => r.type === 'subscription')
      .reduce((acc, r) => acc + (pillarTotals._subtotals[r.id] || 0), 0)
  );
  const swMaint = round2(
    appState.pillars.software.items
      .filter((r) => r.type === 'maintenance')
      .reduce((acc, r) => acc + (pillarTotals._subtotals[r.id] || 0), 0)
  );

  const capex = round2(pillarTotals.hardware + swSetup + pillarTotals.installation);
  const opex = round2(swSub + swMaint + pillarTotals.human_resources);

  return {
    pillar_totals: {
      hardware: pillarTotals.hardware,
      software: pillarTotals.software,
      installation: pillarTotals.installation,
      human_resources: pillarTotals.human_resources,
      _subtotals: pillarTotals._subtotals,
    },
    taxable_base,
    ppn_total,
    grand_total_before_tax: grandBeforeTax,
    grand_total_after_tax: grandAfterTax,
    capex,
    opex,
    software_breakdown: { setup: swSetup, subscription: swSub, maintenance: swMaint },
  };
}
