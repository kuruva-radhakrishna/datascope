'use strict';

// Per-column type inference by voting over values.
// Types: integer | float | date | boolean | categorical | text
// Key behaviors:
//  - numeric column with <= 20 distinct values => categorical (pincode trap)
//  - >= 95% numeric with a few strings => numeric WITH a quality flag, not demoted to text
//  - dates: ISO (YYYY-MM-DD), DD/MM/YYYY, DD-MM-YY, DD-MM-YYYY; mixed formats flagged

const DATE_FORMATS = [
  { name: 'ISO (YYYY-MM-DD)', re: /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/, parts: (m) => [+m[1], +m[2], +m[3]] },
  { name: 'DD/MM/YYYY', re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, parts: (m) => [+m[3], +m[2], +m[1]] },
  { name: 'DD-MM-YYYY', re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, parts: (m) => [+m[3], +m[2], +m[1]] },
  { name: 'DD-MM-YY', re: /^(\d{1,2})-(\d{1,2})-(\d{2})$/, parts: (m) => [2000 + +m[3], +m[2], +m[1]] },
];

function tryParseDate(s) {
  for (const f of DATE_FORMATS) {
    const m = f.re.exec(s);
    if (!m) continue;
    const [y, mo, d] = f.parts(m);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) continue;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue; // e.g. 31/02
    return { format: f.name, ts: dt.getTime() };
  }
  return null;
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_SET = new Set(['true', 'false', 'yes', 'no']);

function inferColumn(name, values) {
  const nonEmpty = [];
  let nulls = 0;
  for (const v of values) {
    const t = String(v).trim();
    if (t === '' || /^(null|na|n\/a|none)$/i.test(t)) nulls++;
    else nonEmpty.push(t);
  }
  const total = values.length;
  const flags = [];
  const distinct = new Set(nonEmpty);

  if (nonEmpty.length === 0) {
    return { name, type: 'text', nulls, nonNullCount: 0, distinct: 0, flags: ['column is entirely empty'] };
  }

  let numCount = 0, intCount = 0, boolCount = 0, dateCount = 0;
  const dateFormats = new Map();
  for (const v of nonEmpty) {
    const cleaned = v.replace(/,/g, ''); // "1,299" style numbers
    if (NUM_RE.test(cleaned)) {
      numCount++;
      if (/^[+-]?\d+$/.test(cleaned)) intCount++;
    }
    if (BOOL_SET.has(v.toLowerCase())) boolCount++;
    const d = tryParseDate(v);
    if (d) {
      dateCount++;
      dateFormats.set(d.format, (dateFormats.get(d.format) || 0) + 1);
    }
  }

  const numFrac = numCount / nonEmpty.length;
  const dateFrac = dateCount / nonEmpty.length;
  const boolFrac = boolCount / nonEmpty.length;

  let type;
  // Pure integer strings also date-parse rarely; prefer date only when format-shaped values dominate
  if (dateFrac >= 0.9 && numFrac < 0.9) {
    type = 'date';
    if (dateFormats.size > 1) {
      const fmts = [...dateFormats.entries()].map(([f, c]) => `${f} (${c})`).join(', ');
      flags.push(`mixed date formats: ${fmts}`);
    }
    if (dateCount < nonEmpty.length) flags.push(`${nonEmpty.length - dateCount} unparseable date values`);
  } else if (boolFrac >= 0.95) {
    type = 'boolean';
  } else if (numFrac >= 0.95) {
    type = intCount === numCount ? 'integer' : 'float';
    if (numCount < nonEmpty.length) {
      flags.push(`${nonEmpty.length - numCount} non-numeric values in column "${name}"`);
    }
    if (distinct.size <= 20 && distinct.size < nonEmpty.length * 0.5) {
      type = 'categorical'; // pincode trap: low-cardinality numbers are labels, not measures
      flags.push(`numeric-looking but only ${distinct.size} distinct values — treated as categorical`);
    }
  } else if (distinct.size <= Math.max(20, nonEmpty.length * 0.05)) {
    type = 'categorical';
  } else {
    type = 'text';
  }

  return { name, type, nulls, nonNullCount: nonEmpty.length, distinct: distinct.size, flags };
}

// numeric value extraction used by the profiler / stats
function toNumber(raw) {
  const t = String(raw).trim().replace(/,/g, '');
  if (t === '' || !NUM_RE.test(t)) return null;
  return Number(t);
}

function inferTypes(headers, rows) {
  return headers.map((h, c) => inferColumn(h, rows.map((r) => r[c])));
}

module.exports = { inferTypes, inferColumn, tryParseDate, toNumber, DATE_FORMATS };
