// Deviota CalcEngine — PCB Pricing Sheet Web App bridge.
//
// Deploy:
//   1. In your Google Sheet: Extensions > Apps Script.
//   2. Replace the contents of Code.gs with this file.
//   3. Set SHARED_SECRET below to a value only you and your father know
//      (do not reuse a real password — this is a simple shared token).
//   4. Deploy > New deployment > type "Web app".
//      Execute as: Me. Who has access: Anyone with the link.
//   5. Copy the Web App URL into CalcEngine's "Apps Script Web App URL"
//      field, and the same secret into "Shared secret".
//
// Anyone with the Web App URL can read pricing rows (doGet); only requests
// carrying the matching secret can append rows (doPost). This keeps the
// Sheet's write access gated without requiring end users to sign into Google.

const SHEET_NAME = 'PCB Pricing';
const SHARED_SECRET = 'change-me';
const HEADERS = ['id', 'name', 'source', 'category', 'currency', 'capital_cost', 'min_multiplier', 'transport_cost', 'sell_price', 'notes'];

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet tab "${SHEET_NAME}" not found.`);
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Returns all pricing rows as JSON: { ok: true, rows: [...] }. */
function doGet(e) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = values.slice(1)
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });
  return jsonResponse_({ ok: true, rows });
}

/** Appends quotation rows, writing a live Sheets formula into the sell_price
    column (capital_cost * min_multiplier + transport_cost) rather than a
    static number, so the father can audit/adjust the math directly in Sheets.
    Body: { secret, rows: [{ id, name, source, category, currency,
    capital_cost, min_multiplier, transport_cost, notes }] }. */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return jsonResponse_({ ok: false, error: 'Invalid shared secret.' });
    }
    const sheet = getSheet_();
    const startRow = sheet.getLastRow() + 1;
    (body.rows || []).forEach((row, idx) => {
      const r = startRow + idx;
      sheet.getRange(r, 1).setValue(row.id || '');
      sheet.getRange(r, 2).setValue(row.name || '');
      sheet.getRange(r, 3).setValue(row.source || '');
      sheet.getRange(r, 4).setValue(row.category || '');
      sheet.getRange(r, 5).setValue(row.currency || '');
      sheet.getRange(r, 6).setValue(row.capital_cost || 0);
      sheet.getRange(r, 7).setValue(row.min_multiplier || 2);
      sheet.getRange(r, 8).setValue(row.transport_cost || 0);
      sheet.getRange(r, 9).setFormula(`=F${r}*G${r}+H${r}`);
      sheet.getRange(r, 10).setValue(row.notes || '');
    });
    return jsonResponse_({ ok: true, appended: (body.rows || []).length });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}
