'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildXlsx } = require('../lib/xlsx.js');
const { headSheets, resultSheets } = require('../lib/export.js');

// A real .xlsx is a zip: local file header 'PK\x03\x04' then, at the very
// end, the end-of-central-directory record 'PK\x05\x06'. Checking both
// signatures plus a parseable central directory is enough to confirm the
// hand-written writer produced a structurally valid archive without pulling
// in a zip-reading dependency just for the test.
function assertValidZip(buf) {
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'must start with a local file header signature');
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdIndex = buf.lastIndexOf(eocdSig);
  assert.ok(eocdIndex > 0, 'must contain an end-of-central-directory record');
  const count = buf.readUInt16LE(eocdIndex + 10);
  const cdSize = buf.readUInt32LE(eocdIndex + 12);
  const cdOffset = buf.readUInt32LE(eocdIndex + 16);
  assert.ok(count >= 1, 'central directory should list at least one entry');
  assert.strictEqual(buf.readUInt32LE(cdOffset), 0x02014b50, 'central directory should start where EOCD says it does');
  assert.strictEqual(cdOffset + cdSize, eocdIndex, 'central directory size should butt up against EOCD');
  return count;
}

test('buildXlsx produces a structurally valid zip with one sheet per input', () => {
  const buf = buildXlsx([
    { name: 'head', rows: [['a', 'b'], [1, 2], [3, 4]] },
    { name: 'summary', rows: [['Test', 'Welch t'], ['p', 0.001]] },
  ]);
  assert.ok(Buffer.isBuffer(buf));
  assertValidZip(buf);
  // 4 fixed parts ([Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels) + 2 sheets
  const text = buf.toString('latin1');
  assert.ok(text.includes('xl/worksheets/sheet1.xml'));
  assert.ok(text.includes('xl/worksheets/sheet2.xml'));
  assert.ok(text.includes('<Override PartName="/xl/worksheets/sheet2.xml"'));
});

test('buildXlsx escapes special characters and keeps numbers as numbers', () => {
  const buf = buildXlsx([{ name: 's', rows: [['col'], ['5 < 10 & "quoted"'], [42]] }]);
  const text = buf.toString('utf8');
  assert.ok(text.includes('&lt;'), 'should escape <');
  assert.ok(text.includes('&amp;'), 'should escape &');
  assert.ok(text.includes('<v>42</v>'), 'numbers should be written as <v> not inline strings');
});

test('buildXlsx sanitizes and truncates sheet names to the 31-char Excel limit', () => {
  const buf = buildXlsx([{ name: 'a'.repeat(40) + '[bad]/chars', rows: [['x']] }]);
  const text = buf.toString('latin1');
  const m = text.match(/<sheet name="([^"]+)"/);
  assert.ok(m, 'workbook.xml should declare the sheet name');
  assert.ok(m[1].length <= 31, `sheet name should be truncated, got length ${m[1].length}`);
  assert.ok(!/[\\/?*[\]:]/.test(m[1]), 'sheet name should have illegal characters stripped');
});

test('headSheets converts numeric-looking strings to real numbers, keeps text as text', () => {
  const dataset = { headers: ['id', 'price', 'state'] };
  const rows = [['ORD1', '199.50', 'Karnataka'], ['ORD2', 'error', 'Maharashtra']];
  const sheets = headSheets(dataset, rows, 10);
  assert.strictEqual(sheets.length, 1);
  assert.strictEqual(sheets[0].name, 'head');
  assert.deepStrictEqual(sheets[0].rows[0], dataset.headers);
  assert.strictEqual(sheets[0].rows[1][1], 199.5, 'numeric string should become a number');
  assert.strictEqual(sheets[0].rows[2][1], 'error', 'non-numeric string should stay a string');
});

test('headSheets respects the row limit n', () => {
  const dataset = { headers: ['a'] };
  const rows = Array.from({ length: 30 }, (_, i) => [String(i)]);
  const sheets = headSheets(dataset, rows, 5);
  assert.strictEqual(sheets[0].rows.length, 6); // header + 5 data rows
});

test('resultSheets builds a summary + data sheet for every test type', () => {
  const welch = resultSheets('is price different?', {
    test: 'welch-t', metric: 'price', groupCol: 'state', t: 2.1, df: 40, p: 0.03, cohenD: 0.5,
    group1: 'A', group2: 'B', n1: 20, n2: 22, mean1: 100, mean2: 90, sd1: 10, sd2: 12,
  });
  assert.strictEqual(welch.length, 2);
  assert.strictEqual(welch[0].name, 'summary');
  assert.strictEqual(welch[1].name, 'groups');
  assert.ok(welch[0].rows.some((r) => r[0] === 'p-value' && r[1] === 0.03));
  assert.deepStrictEqual(welch[1].rows[0], ['Group', 'n', 'Mean', 'Std dev']);

  const chisq = resultSheets('q', {
    test: 'chi-square', col1: 'courier', col2: 'returned', chi2: 12.3, df: 2, p: 0.002, warning: null,
    colCats: ['yes', 'no'], table: [{ category: 'A', cells: [{ col: 'yes', observed: 5, expected: 4.2 }, { col: 'no', observed: 10, expected: 10.8 }] }],
  });
  assert.strictEqual(chisq.length, 3);
  assert.deepStrictEqual(chisq[0].name, 'summary');
  assert.deepStrictEqual(chisq[1].rows[0], ['Category', 'yes', 'no']);

  const corr = resultSheets('q', { test: 'correlation', col1: 'price', col2: 'fee', r: 0.9, n: 50, p: 0.0001, points: [[1, 2], [3, 4]] });
  assert.strictEqual(corr.length, 2);
  assert.strictEqual(corr[1].rows.length, 3); // header + 2 points

  const agg = resultSheets('q', { test: 'aggregate', groupBy: 'state', agg: 'mean', metric: 'price', results: [{ group: 'A', value: 100, n: 5 }] });
  assert.strictEqual(agg[1].rows[1], undefined === agg[1].rows[1] ? agg[1].rows[1] : agg[1].rows[1]);
  assert.deepStrictEqual(agg[1].rows[1], ['A', 100, 5]);
});

test('resultSheets never throws on an error-shaped result', () => {
  assert.doesNotThrow(() => resultSheets('q', { test: 'welch-t', error: 'boom' }));
});
