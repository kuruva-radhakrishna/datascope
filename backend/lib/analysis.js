'use strict';

// Executes statistical tests and aggregates against a dataset's raw rows.
// Shared by the "Run test" API endpoint and the chat orchestrator —
// the LLM never computes numbers, this module does.

const S = require('./stats.js');
const { toNumber } = require('./infer.js');

function colIndex(headers, name) {
  if (name == null) return -1;
  const target = String(name).trim().toLowerCase();
  let idx = headers.findIndex((h) => h.toLowerCase() === target);
  if (idx === -1) idx = headers.findIndex((h) => h.toLowerCase().includes(target) || target.includes(h.toLowerCase()));
  return idx;
}

// 3×IQR fences over a column's numeric values; values outside are extreme outliers
function iqrFences(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 20) return null;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr <= 0) return null;
  return { lo: q1 - 3 * iqr, hi: q3 + 3 * iqr };
}

function groupedNumeric(headers, rows, metric, groupCol, trim) {
  const mi = colIndex(headers, metric), gi = colIndex(headers, groupCol);
  if (mi === -1) return { error: `column "${metric}" not found` };
  if (gi === -1) return { error: `column "${groupCol}" not found` };
  const fences = trim ? iqrFences(rows.map((r) => toNumber(r[mi])).filter((v) => v !== null)) : null;
  const groups = {};
  let trimmed = 0;
  for (const r of rows) {
    const g = String(r[gi]).trim();
    const v = toNumber(r[mi]);
    if (g === '' || v === null) continue;
    if (fences && (v < fences.lo || v > fences.hi)) { trimmed++; continue; }
    (groups[g] = groups[g] || []).push(v);
  }
  return { groups, metricName: headers[mi], groupName: headers[gi], trimmed };
}

function runTTest(headers, rows, { metric, groupCol, groups: wanted, trim }) {
  const g = groupedNumeric(headers, rows, metric, groupCol, trim);
  if (g.error) return g;
  let labels = Object.keys(g.groups).sort((a, b) => g.groups[b].length - g.groups[a].length);
  if (Array.isArray(wanted) && wanted.length === 2) {
    const chosen = wanted.map((w) => labels.find((l) => l.toLowerCase() === String(w).toLowerCase().trim()) ||
      labels.find((l) => l.toLowerCase().includes(String(w).toLowerCase().trim())));
    if (chosen.every(Boolean)) labels = chosen;
    else return { error: `groups ${JSON.stringify(wanted)} not found in "${g.groupName}" (available: ${labels.slice(0, 6).join(', ')})` };
  }
  if (labels.length < 2) return { error: `"${g.groupName}" has fewer than 2 groups with numeric ${g.metricName}` };
  const [l1, l2] = labels;
  const result = S.welchTTest(g.groups[l1], g.groups[l2]);
  if (result.error) return result;
  return { ...result, metric: g.metricName, groupCol: g.groupName, group1: l1, group2: l2, trimmed: g.trimmed || 0 };
}

function runChiSquare(headers, rows, { col1, col2 }) {
  const i1 = colIndex(headers, col1), i2 = colIndex(headers, col2);
  if (i1 === -1) return { error: `column "${col1}" not found` };
  if (i2 === -1) return { error: `column "${col2}" not found` };
  const a = [], b = [];
  for (const r of rows) {
    const x = String(r[i1]).trim(), y = String(r[i2]).trim();
    if (x === '' || y === '') continue;
    a.push(x); b.push(y);
  }
  const result = S.chiSquareIndependence(a, b);
  if (result.error) return result;
  return { ...result, col1: headers[i1], col2: headers[i2] };
}

function runANOVA(headers, rows, { metric, groupCol, trim }) {
  const g = groupedNumeric(headers, rows, metric, groupCol, trim);
  if (g.error) return g;
  const result = S.oneWayANOVA(g.groups);
  if (result.error) return result;
  return { ...result, metric: g.metricName, groupCol: g.groupName, trimmed: g.trimmed || 0 };
}

function runCorrelation(headers, rows, { col1, col2, trim }) {
  const i1 = colIndex(headers, col1), i2 = colIndex(headers, col2);
  if (i1 === -1) return { error: `column "${col1}" not found` };
  if (i2 === -1) return { error: `column "${col2}" not found` };
  let xs = [], ys = [];
  for (const r of rows) {
    const x = toNumber(r[i1]), y = toNumber(r[i2]);
    if (x !== null && y !== null) { xs.push(x); ys.push(y); }
  }
  let trimmed = 0;
  if (trim) {
    const fx = iqrFences(xs), fy = iqrFences(ys);
    if (fx || fy) {
      const keptX = [], keptY = [];
      for (let i = 0; i < xs.length; i++) {
        const outX = fx && (xs[i] < fx.lo || xs[i] > fx.hi);
        const outY = fy && (ys[i] < fy.lo || ys[i] > fy.hi);
        if (outX || outY) { trimmed++; continue; }
        keptX.push(xs[i]); keptY.push(ys[i]);
      }
      xs = keptX; ys = keptY;
    }
  }
  const result = S.correlationTest(xs, ys);
  if (result.error) return result;
  // evenly-sampled points so the frontend can draw a scatter plot
  const step = Math.max(1, Math.floor(xs.length / 120));
  const points = [];
  for (let i = 0; i < xs.length; i += step) points.push([xs[i], ys[i]]);
  return { ...result, col1: headers[i1], col2: headers[i2], points, trimmed };
}

function runAggregate(headers, rows, { groupBy, agg = 'mean', metric, topN = 10, trim }) {
  const gi = colIndex(headers, groupBy);
  if (gi === -1) return { error: `column "${groupBy}" not found` };
  const mi = metric ? colIndex(headers, metric) : -1;
  if (agg !== 'count' && mi === -1) return { error: `column "${metric}" not found` };
  const fences = trim && mi !== -1 ? iqrFences(rows.map((r) => toNumber(r[mi])).filter((v) => v !== null)) : null;
  const acc = new Map();
  let trimmed = 0;
  for (const r of rows) {
    const g = String(r[gi]).trim();
    if (g === '') continue;
    const entry = acc.get(g) || { sum: 0, n: 0 };
    if (agg === 'count') entry.n++;
    else {
      const v = toNumber(r[mi]);
      if (v === null) continue;
      if (fences && (v < fences.lo || v > fences.hi)) { trimmed++; continue; }
      entry.sum += v; entry.n++;
    }
    acc.set(g, entry);
  }
  let out = [...acc.entries()].map(([group, { sum, n }]) => ({
    group, n, value: agg === 'count' ? n : agg === 'sum' ? +sum.toFixed(2) : +(sum / n).toFixed(2),
  }));
  out.sort((a, b) => b.value - a.value);
  out = out.slice(0, Math.min(50, topN));
  return { test: 'aggregate', agg, groupBy: headers[gi], metric: mi !== -1 ? headers[mi] : null, results: out, trimmed };
}

function runIntent(headers, rows, intent) {
  switch (intent.action) {
    case 'ttest': return runTTest(headers, rows, intent);
    case 'chisq': return runChiSquare(headers, rows, intent);
    case 'anova': return runANOVA(headers, rows, intent);
    case 'correlation': return runCorrelation(headers, rows, intent);
    case 'aggregate': return runAggregate(headers, rows, intent);
    default: return { error: `unknown action "${intent.action}"` };
  }
}

module.exports = { runTTest, runChiSquare, runANOVA, runCorrelation, runAggregate, runIntent, colIndex };
