'use strict';

// Hand-written CSV parser: quoted fields, embedded commas/newlines, CRLF, BOM.
// Returns { headers: string[], rows: string[][] } — cells are raw strings, '' = empty.
function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV input must be a string');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { // CRLF or lone CR
      row.push(field); field = ''; rows.push(row); row = [];
      i += text[i + 1] === '\n' ? 2 : 1; continue;
    }
    if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // Drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  if (rows.length === 0) throw new Error('CSV is empty');

  const headers = rows[0].map((h, idx) => (h.trim() === '' ? `column_${idx + 1}` : h.trim()));
  const width = headers.length;
  const dataRows = rows.slice(1).map((r) => {
    if (r.length === width) return r;
    if (r.length < width) return r.concat(Array(width - r.length).fill(''));
    return r.slice(0, width);
  });
  return { headers, rows: dataRows };
}

module.exports = { parseCSV };
