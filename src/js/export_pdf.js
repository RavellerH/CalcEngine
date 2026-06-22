/* PDF export via pdfmake. Builds a printable quote document from appState. */

function formatCurrency(value, currency) {
  const num = Number(value) || 0;
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pillarTableBody(pillar, items, subtotals, currency) {
  const header = [
    { text: 'No', style: 'tableHeader' },
    { text: 'Description', style: 'tableHeader' },
    { text: 'Qty', style: 'tableHeader' },
    { text: 'Unit Price', style: 'tableHeader' },
    { text: 'Subtotal', style: 'tableHeader' },
    { text: 'PPN', style: 'tableHeader' },
  ];
  const rows = items.map((row, idx) => {
    const label = row.name || row.role || 'Item';
    const qty = row.quantity ?? row.duration_months ?? row.duration_days ?? 1;
    const unitPrice = row.unit_cost ?? row.rate_per_month ?? row.custom_rate ?? 0;
    return [
      { text: String(idx + 1), alignment: 'center' },
      label,
      { text: String(qty), alignment: 'center' },
      { text: formatCurrency(unitPrice, row.currency || currency), alignment: 'right' },
      { text: formatCurrency(subtotals[row.id], currency), alignment: 'right' },
      { text: row.taxable_ppn ? 'Yes' : 'No', alignment: 'center' },
    ];
  });
  return [header, ...rows];
}

function buildPdfDocDefinition(appState, totals) {
  const { project, config, pillars } = appState;
  const currency = config.display_currency;
  const subtotals = totals.pillar_totals._subtotals || computeAllRowSubtotals(appState);

  const content = [
    {
      columns: [
        { text: APP_NAME, style: 'header' },
        { text: new Date().toLocaleDateString(), alignment: 'right', style: 'subheader' },
      ],
    },
    { text: project.name || 'Untitled Simulation', style: 'title', margin: [0, 10, 0, 0] },
    {
      columns: [
        { text: `Client: ${project.client || '-'}`, style: 'subheader' },
        { text: `Contact: ${project.contact_person || '-'}`, style: 'subheader', alignment: 'right' },
      ],
    },
    { text: ' ', margin: [0, 4, 0, 4] },
    { text: 'Summary', style: 'sectionTitle' },
    {
      table: {
        widths: ['*', 'auto'],
        body: [
          ['Hardware', formatCurrency(totals.pillar_totals.hardware, currency)],
          ['Software', formatCurrency(totals.pillar_totals.software, currency)],
          ['Installation', formatCurrency(totals.pillar_totals.installation, currency)],
          ['Human Resources', formatCurrency(totals.pillar_totals.human_resources, currency)],
          ['Taxable Base', formatCurrency(totals.taxable_base, currency)],
          [`PPN (${(config.tax.ppn_rate * 100).toFixed(0)}%)`, formatCurrency(totals.ppn_total, currency)],
          [{ text: 'Grand Total', bold: true }, { text: formatCurrency(totals.grand_total_after_tax, currency), bold: true }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 16],
    },
  ];

  PILLARS.forEach((pillarKey) => {
    const items = pillars[pillarKey].items;
    if (!items.length) return;
    content.push({ text: PILLAR_LABELS[pillarKey], style: 'sectionTitle', margin: [0, 8, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
        body: pillarTableBody(pillarKey, items, subtotals, currency),
      },
      layout: 'lightHorizontalLines',
    });
  });

  content.push({
    text: 'This document is a system-generated cost simulation and does not constitute a binding quotation unless countersigned by an authorized Deviota representative.',
    style: 'footerNote',
    margin: [0, 20, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content,
    styles: {
      header: { fontSize: 16, bold: true, color: '#1d4ed8' },
      title: { fontSize: 14, bold: true },
      subheader: { fontSize: 10, color: '#475569' },
      sectionTitle: { fontSize: 12, bold: true, color: '#1e293b' },
      tableHeader: { bold: true, fillColor: '#f1f5f9' },
      footerNote: { fontSize: 8, italics: true, color: '#94a3b8' },
    },
    defaultStyle: { fontSize: 9 },
  };
}

function exportStateToPdf(appState, totals) {
  if (typeof pdfMake === 'undefined') {
    throw new Error('pdfmake library is not loaded.');
  }
  const docDefinition = buildPdfDocDefinition(appState, totals);
  const safeName = (appState.project.name || 'simulation').replace(/[^a-z0-9-_]+/gi, '_');
  pdfMake.createPdf(docDefinition).download(`${safeName}-calcengine.pdf`);
}
