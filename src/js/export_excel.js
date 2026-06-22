/* Excel export via SheetJS. Builds a multi-sheet workbook from appState. */

function buildSummarySheetRows(appState, totals) {
  const currency = appState.config.display_currency;
  return [
    { Metric: 'Hardware Total', Value: totals.pillar_totals.hardware, Currency: currency },
    { Metric: 'Software Total', Value: totals.pillar_totals.software, Currency: currency },
    { Metric: 'Installation Total', Value: totals.pillar_totals.installation, Currency: currency },
    { Metric: 'Human Resources Total', Value: totals.pillar_totals.human_resources, Currency: currency },
    { Metric: 'Taxable Base', Value: totals.taxable_base, Currency: currency },
    { Metric: 'PPN Total', Value: totals.ppn_total, Currency: currency },
    { Metric: 'Grand Total (before tax)', Value: totals.grand_total_before_tax, Currency: currency },
    { Metric: 'Grand Total (after tax)', Value: totals.grand_total_after_tax, Currency: currency },
    { Metric: 'CAPEX', Value: totals.capex, Currency: currency },
    { Metric: 'OPEX', Value: totals.opex, Currency: currency },
  ];
}

function pillarSheetRows(pillarKey, items, subtotals) {
  return items.map((row, idx) => ({
    No: idx + 1,
    Name: row.name || row.role || '',
    Description: row.description || '',
    Unit: row.unit || row.rate_basis || '',
    Quantity: row.quantity ?? row.duration_months ?? row.duration_days ?? '',
    Currency: row.currency || '',
    'Unit Cost': row.unit_cost ?? row.rate_per_month ?? row.custom_rate ?? '',
    'Margin %': row.margin_pct != null ? row.margin_pct : '',
    'Taxable PPN': row.taxable_ppn ? 'Yes' : 'No',
    Subtotal: subtotals[row.id] ?? 0,
  }));
}

function exportStateToExcel(appState, totals) {
  if (typeof XLSX === 'undefined') {
    throw new Error('SheetJS (xlsx) library is not loaded.');
  }
  const subtotals = totals.pillar_totals._subtotals || computeAllRowSubtotals(appState);
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(buildSummarySheetRows(appState, totals));
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  PILLARS.forEach((pillarKey) => {
    const items = appState.pillars[pillarKey].items;
    const rows = pillarSheetRows(pillarKey, items, subtotals);
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(workbook, sheet, PILLAR_LABELS[pillarKey]);
  });

  const safeName = (appState.project.name || 'simulation').replace(/[^a-z0-9-_]+/gi, '_');
  XLSX.writeFile(workbook, `${safeName}-calcengine.xlsx`);
}
