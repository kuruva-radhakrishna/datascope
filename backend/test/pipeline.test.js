'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { generateSeedCSV } = require('../lib/seedgen.js');
const { parseCSV } = require('../lib/csv.js');
const { buildProfile } = require('../lib/profile.js');
const { runTTest, runChiSquare, runAggregate, runCorrelation } = require('../lib/analysis.js');

const csv = generateSeedCSV();
const { headers, rows } = parseCSV(csv);
const profile = buildProfile(headers, rows);

test('CSV parser handles the seed file', () => {
  assert.strictEqual(headers.length, 10);
  assert.strictEqual(rows.length, 500);
  assert.strictEqual(headers[0], 'order_id');
  assert.ok(headers.includes('shipping_fee'));
});

test('parser handles quotes, embedded commas and CRLF', () => {
  const tricky = 'a,b,c\r\n"x, y",2,"line\nbreak"\r\n"has ""quotes""",4,plain\r\n';
  const p = parseCSV(tricky);
  assert.deepStrictEqual(p.rows[0], ['x, y', '2', 'line\nbreak']);
  assert.deepStrictEqual(p.rows[1], ['has "quotes"', '4', 'plain']);
});

test('type inference: price numeric despite noise, date flagged as mixed', () => {
  const cols = Object.fromEntries(profile.columns.map((c) => [c.name, c]));
  assert.ok(['integer', 'float'].includes(cols.price.type), `price should stay numeric, got ${cols.price.type}`);
  assert.ok(cols.price.flags.some((f) => f.includes('non-numeric')), 'price should carry a non-numeric noise flag');
  assert.strictEqual(cols.order_date.type, 'date');
  assert.ok(cols.order_date.flags.some((f) => f.startsWith('mixed date formats')), 'mixed date formats should be flagged');
  assert.strictEqual(cols.courier.type, 'categorical');
  assert.strictEqual(cols.returned.type, 'boolean');
});

test('profile finds the planted quality problems', () => {
  assert.ok(profile.quality.score < 100, `quality score should be < 100, got ${profile.quality.score}`);
  assert.ok(profile.quality.score > 0, 'score should not bottom out');
  assert.ok(profile.testRows.length >= 2, `should find planted test rows, got ${profile.testRows.length}`);
  assert.ok(profile.duplicates >= 2, `should find planted duplicates, got ${profile.duplicates}`);
  assert.ok(profile.anomalies.some((a) => a.column === 'price' && a.value === 49999), 'should catch the 49999 price outlier');
  assert.ok(profile.insights.length >= 3, `should produce at least 3 insights, got ${profile.insights.length}`);
});

test('t-test detects the planted Karnataka vs Maharashtra AOV gap (outlier-trimmed)', () => {
  const r = runTTest(headers, rows, { metric: 'price', groupCol: 'state', groups: ['Karnataka', 'Maharashtra'], trim: true });
  assert.ok(!r.error, r.error);
  assert.ok(r.p < 0.01, `planted AOV gap should be significant, got p=${r.p}`);
  assert.ok(r.mean1 > r.mean2, 'Karnataka mean should exceed Maharashtra mean');
  assert.ok(r.trimmed >= 1, 'the planted 49999 outlier should be trimmed');
});

test('chi-square detects the planted courier return-rate difference', () => {
  const r = runChiSquare(headers, rows, { col1: 'courier', col2: 'returned' });
  assert.ok(!r.error, r.error);
  assert.ok(r.p < 0.01, `planted courier effect should be significant, got p=${r.p}`);
});

test('correlation: shipping_fee tracks price with sampled scatter points (trimmed)', () => {
  const r = runCorrelation(headers, rows, { col1: 'price', col2: 'shipping_fee', trim: true });
  assert.ok(!r.error, r.error);
  assert.ok(r.r > 0.4, `planted correlation should be positive and clear, got r=${r.r}`);
  assert.ok(r.p < 0.01, `should be significant, got p=${r.p}`);
  assert.ok(Array.isArray(r.points) && r.points.length >= 50, 'should include sampled points for the scatter plot');
});

test('aggregate: Karnataka mean price beats Maharashtra (planted contrast)', () => {
  const r = runAggregate(headers, rows, { groupBy: 'state', agg: 'mean', metric: 'price', topN: 10, trim: true });
  assert.ok(!r.error, r.error);
  const ka = r.results.find((x) => x.group === 'Karnataka');
  const mh = r.results.find((x) => x.group === 'Maharashtra');
  assert.ok(ka && mh, 'both states present');
  assert.ok(ka.value > mh.value, `Karnataka (${ka.value}) should exceed Maharashtra (${mh.value})`);
});
