/* PCB pricing database (Google Sheets) integration.
   Fetches a Google Sheet published-to-web as CSV into the hardware catalog, parses
   uploaded BOM/quote documents (CSV/XLSX/PDF) from EasyEDA/JLCPCB, computes the
   "2x capital + transport" quotation rule, and produces Sheet-ready exports
   (download as .xlsx, or copy as tab-separated formulas for pasting into the Sheet).

   No backend / no Google auth: the Sheet is read via its public published-CSV URL,
   and writes back are "manual paste" — the app never holds Google credentials. */

const PCB_SHEET_COLUMNS = [
  'id', 'name', 'source', 'category', 'currency',
  'capital_cost', 'min_multiplier', 'transport_cost', 'sell_price', 'notes',
];
const DEFAULT_MIN_MULTIPLIER = 2;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Minimal RFC4180-ish CSV parser supporting quoted fields with commas/newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeKey(key) {
  return String(key).trim().toLowerCase().replace(/\s+/g, '_');
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeKey);
  return rows
    .slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? String(r[idx]).trim() : ''; });
      return obj;
    });
}

function pricingRowToCatalogItem(o) {
  const name = o.name || o.part || o.component;
  if (!name) return null;
  const capitalCost = Number(o.capital_cost ?? o.cost ?? o.unit_cost) || 0;
  const multiplier = Number(o.min_multiplier ?? o.multiplier) || DEFAULT_MIN_MULTIPLIER;
  const transport = Number(o.transport_cost ?? o.transport) || 0;
  return {
    id: o.id || `PCB-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    pillar: 'hardware',
    name,
    description: o.notes || '',
    source: o.source || 'Google Sheet',
    category: o.category || '',
    unit: 'pcs',
    currency: (o.currency || 'USD').toUpperCase(),
    unit_cost: capitalCost,
    capital_cost: capitalCost,
    transport_cost: transport,
    default_margin_pct: multiplier - 1,
    taxable_ppn: true,
    metadata: { from_sheet: true },
  };
}

/** Fetches a Google Sheet published as CSV (File > Share > Publish to web > CSV)
    and parses it into hardware-catalog-shaped items. */
async function fetchPcbPricingSheet(csvUrl) {
  if (!csvUrl) throw new Error('No pricing sheet URL configured.');
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Sheet request failed with status ${res.status}`);
  const text = await res.text();
  return rowsToObjects(parseCsv(text)).map(pricingRowToCatalogItem).filter(Boolean);
}

/** Fetches pricing rows via the Apps Script Web App bridge (tools/apps-script/Code.gs),
    which proxies reads/writes to the bound Sheet without requiring the end user to
    sign into Google. Preferred over fetchPcbPricingSheet() once the Web App is deployed,
    since it also unlocks pushQuotationToAppsScript() for true automated writes. */
async function fetchPcbPricingViaAppsScript(webAppUrl) {
  if (!webAppUrl) throw new Error('No Apps Script Web App URL configured.');
  const res = await fetch(webAppUrl, { method: 'GET' });
  if (!res.ok) throw new Error(`Apps Script request failed with status ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Apps Script returned an error.');
  return data.rows.map(pricingRowToCatalogItem).filter(Boolean);
}

/** Appends quotation rows to the Sheet via the Apps Script Web App bridge, with the
    Sheet itself computing sell_price as a live formula (see Code.gs doPost). The
    Content-Type below must stay text/plain: Apps Script Web Apps don't support CORS
    preflight, and a JSON content-type would trigger one and fail. */
async function pushQuotationToAppsScript(webAppUrl, sharedSecret, quotationRows) {
  if (!webAppUrl) throw new Error('No Apps Script Web App URL configured.');
  const rows = quotationRows.map((r) => ({
    id: r.id || '', name: r.name, source: r.source || '', category: r.category || '',
    currency: r.currency || 'USD', capital_cost: r.capital_cost, min_multiplier: r.min_multiplier,
    transport_cost: r.transport_cost, notes: r.notes || '',
  }));
  const res = await fetch(webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: sharedSecret, rows }),
  });
  if (!res.ok) throw new Error(`Apps Script request failed with status ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Apps Script returned an error.');
  return data.appended;
}

function bomRowToLineItem(o) {
  const name = o.name || o.part || o.comment || o.description || o.designator;
  if (!name) return null;
  return {
    name: String(name),
    designator: o.designator || '',
    supplier_part: o.supplier_part || o['supplier_part_no.'] || o.manufacturer_part || '',
    quantity: Number(o.qty || o.quantity) || 1,
    capital_cost: Number(o.unit_price || o.price || o.unit_cost || o.capital_cost) || 0,
    currency: (o.currency || 'USD').toUpperCase(),
  };
}

/** Parses an uploaded BOM/order file (.csv or .xlsx) into line items. */
function parseBomFile(file) {
  const isCsv = /\.csv$/i.test(file.name);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let objs;
        if (isCsv) {
          objs = rowsToObjects(parseCsv(reader.result));
        } else {
          if (typeof XLSX === 'undefined') throw new Error('SheetJS (xlsx) library is not loaded.');
          const wb = XLSX.read(reader.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          objs = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map((row) => {
            const out = {};
            Object.entries(row).forEach(([k, v]) => { out[normalizeKey(k)] = typeof v === 'string' ? v.trim() : v; });
            return out;
          });
        }
        resolve(objs.map(bomRowToLineItem).filter(Boolean));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

/** Best-effort extraction of "<description> <qty> <unit price>" style lines, as found
    in JLCPCB order/quote PDFs. Formats vary — always review/edit parsed rows before use. */
function extractLineItemsFromText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const lineItemPattern = /^(.+?)\s+(?:qty[:\s]*)?(\d+)\s*(?:pcs?\.?)?\s*\$?(\d+(?:[.,]\d{1,2})?)(?:\s*\$?\d+(?:[.,]\d{1,2})?)?$/i;
  const items = [];
  lines.forEach((line) => {
    const m = line.match(lineItemPattern);
    if (m && m[1].trim().length > 1) {
      items.push({
        name: m[1].trim(),
        designator: '',
        supplier_part: '',
        quantity: Number(m[2]),
        capital_cost: Number(m[3].replace(',', '.')),
        currency: 'USD',
      });
    }
  });
  return items;
}

/** Parses a JLCPCB order/quote PDF into line items via pdf.js text extraction. */
async function parsePdfBom(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF parsing library (pdf.js) is not loaded.');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += `${content.items.map((it) => it.str).join(' ')}\n`;
  }
  return extractLineItemsFromText(fullText);
}

/** Tries to fill in missing capital_cost on BOM rows (EasyEDA BOMs have no pricing)
    by matching against the fetched pricing catalog on name or supplier part number. */
function matchBomToCatalog(bomRows, catalog) {
  return bomRows.map((row) => {
    if (row.capital_cost > 0) return row;
    const needle = (row.supplier_part || row.name || '').toLowerCase();
    const match = catalog.find((c) => {
      const hay = `${c.name} ${c.id}`.toLowerCase();
      return needle && (hay.includes(needle) || needle.includes(c.name.toLowerCase()));
    });
    if (!match) return row;
    return { ...row, capital_cost: match.capital_cost ?? match.unit_cost ?? 0, currency: match.currency || row.currency };
  });
}

/** Applies the "2x capital + transport" rule: a flat transport_total is allocated
    across rows proportional to each row's capital subtotal, then
    sell_price = capital_cost * multiplier + (allocated transport per unit). */
function computeQuotationRows(rows, { transportTotal = 0, multiplier = DEFAULT_MIN_MULTIPLIER } = {}) {
  const capitalSubtotal = (r) => (Number(r.capital_cost) || 0) * (Number(r.quantity) || 1);
  const totalCapital = rows.reduce((acc, r) => acc + capitalSubtotal(r), 0);
  return rows.map((r) => {
    const qty = Number(r.quantity) || 1;
    const capitalCost = Number(r.capital_cost) || 0;
    const weight = totalCapital > 0 ? capitalSubtotal(r) / totalCapital : 1 / rows.length;
    const allocatedTransport = round2(transportTotal * weight);
    const transportPerUnit = qty > 0 ? round2(allocatedTransport / qty) : 0;
    const sellPrice = round2(capitalCost * multiplier + transportPerUnit);
    return {
      ...r,
      capital_cost: capitalCost,
      min_multiplier: multiplier,
      transport_cost: transportPerUnit,
      sell_price: sellPrice,
      row_total: round2(sellPrice * qty),
    };
  });
}

/** Builds Sheet-ready rows where the sell-price formula is self-relative via ROW(),
    so it stays correct no matter which row it ends up pasted into. */
function buildSheetExportRows(quotationRows, { capitalCol = 'F', multiplierCol = 'G', transportCol = 'H' } = {}) {
  return quotationRows.map((r) => ({
    id: r.id || '',
    name: r.name,
    source: r.source || '',
    category: r.category || '',
    currency: r.currency || 'USD',
    capital_cost: r.capital_cost,
    min_multiplier: r.min_multiplier,
    transport_cost: r.transport_cost,
    sell_price_formula: `=INDIRECT("${capitalCol}"&ROW())*INDIRECT("${multiplierCol}"&ROW())+INDIRECT("${transportCol}"&ROW())`,
    notes: r.notes || '',
  }));
}

/** Copies tab-separated rows to the clipboard. Pasting into the pricing Sheet at the
    column matching PCB_SHEET_COLUMNS keeps the Sell Price cell a live formula, since
    Google Sheets parses any pasted text starting with "=" as a formula. */
async function copyQuotationForSheets(quotationRows) {
  const exportRows = buildSheetExportRows(quotationRows);
  const lines = exportRows.map((r) =>
    PCB_SHEET_COLUMNS.map((c) => (c === 'sell_price' ? r.sell_price_formula : r[c]) ?? '').join('\t')
  );
  await navigator.clipboard.writeText(lines.join('\n'));
  return exportRows.length;
}

/** Downloads an .xlsx with live formulas in the Sell Price column. Importing it into
    Google Sheets (Insert > Import > Append to current sheet) keeps the formulas live. */
function downloadQuotationWorkbook(quotationRows, filename = 'pcb-quotation-for-sheets.xlsx') {
  if (typeof XLSX === 'undefined') throw new Error('SheetJS (xlsx) library is not loaded.');
  const header = PCB_SHEET_COLUMNS;
  const sellCol = header.indexOf('sell_price');
  const aoa = [header];
  quotationRows.forEach((r) => {
    aoa.push([
      r.id || '', r.name, r.source || '', r.category || '', r.currency || 'USD',
      r.capital_cost, r.min_multiplier, r.transport_cost, null, r.notes || '',
    ]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  quotationRows.forEach((_, idx) => {
    const rowNum = idx + 2; // header occupies row 1
    sheet[XLSX.utils.encode_cell({ r: rowNum - 1, c: sellCol })] = { t: 'n', f: `F${rowNum}*G${rowNum}+H${rowNum}` };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'PCB Pricing');
  XLSX.writeFile(wb, filename);
}

/** Downloads a blank starter workbook matching the expected pricing-sheet schema, for
    bootstrapping a brand-new Google Sheet (File > Import when creating the Sheet). */
function downloadPricingSheetTemplate() {
  if (typeof XLSX === 'undefined') throw new Error('SheetJS (xlsx) library is not loaded.');
  const header = PCB_SHEET_COLUMNS;
  const example = [
    'HW-PCB-CTRL-001', 'Controller PCB Assembly', 'JLCPCB', 'PCB Assembly',
    'USD', 35, 2, 5, null, '4-layer PCB w/ STM32, assembled at JLCPCB',
  ];
  const sheet = XLSX.utils.aoa_to_sheet([header, example]);
  sheet[XLSX.utils.encode_cell({ r: 1, c: header.indexOf('sell_price') })] = { t: 'n', f: 'F2*G2+H2' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'PCB Pricing');
  XLSX.writeFile(wb, 'pcb-pricing-template.xlsx');
}
