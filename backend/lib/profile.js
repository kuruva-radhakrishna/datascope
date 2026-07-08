'use strict';

const { inferTypes, tryParseDate, toNumber } = require('./infer.js');
const S = require('./stats.js');

const TEST_ROW_RE = /^(test|testing|asdf+|qwerty|xxx+|dummy|sample)$/i;

function numericValues(rows, col) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const v = toNumber(rows[i][col]);
    if (v !== null) out.push({ i, v });
  }
  return out;
}

function profileColumn(colInfo, rows, col, rowCount) {
  const p = { ...colInfo, nullPct: rowCount ? +((colInfo.nulls / rowCount) * 100).toFixed(1) : 0 };

  if (colInfo.type === 'integer' || colInfo.type === 'float') {
    const nv = numericValues(rows, col);
    const vals = nv.map((x) => x.v);
    if (vals.length) {
      const sorted = [...vals].sort((a, b) => a - b);
      p.min = sorted[0];
      p.max = sorted[sorted.length - 1];
      p.mean = +S.mean(vals).toFixed(4);
      p.median = S.median(sorted);
      p.stddev = +Math.sqrt(S.variance(vals)).toFixed(4);
      p.skewness = +S.skewness(vals).toFixed(3);
      // histogram (10 bins)
      const bins = 10;
      const lo = p.min, hi = p.max;
      const w = hi > lo ? (hi - lo) / bins : 1;
      const counts = Array(bins).fill(0);
      for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
      p.histogram = counts.map((c, b) => ({ x0: +(lo + b * w).toFixed(2), x1: +(lo + (b + 1) * w).toFixed(2), count: c }));
    }
  } else if (colInfo.type === 'categorical' || colInfo.type === 'boolean' || colInfo.type === 'text') {
    const freq = new Map();
    for (const r of rows) {
      const v = String(r[col]).trim();
      if (v === '') continue;
      freq.set(v, (freq.get(v) || 0) + 1);
    }
    p.topValues = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([value, count]) => ({ value, count }));
    if (freq.size === 1 && rowCount > 1) p.flags = [...(p.flags || []), 'constant column — every row has the same value'];
  } else if (colInfo.type === 'date') {
    let minTs = Infinity, maxTs = -Infinity, future = 0;
    const nowTs = Date.now();
    for (const r of rows) {
      const d = tryParseDate(String(r[col]).trim());
      if (!d) continue;
      if (d.ts < minTs) minTs = d.ts;
      if (d.ts > maxTs) maxTs = d.ts;
      if (d.ts > nowTs) future++;
    }
    if (isFinite(minTs)) {
      p.dateMin = new Date(minTs).toISOString().slice(0, 10);
      p.dateMax = new Date(maxTs).toISOString().slice(0, 10);
    }
    if (future > 0) p.flags = [...(p.flags || []), `${future} date(s) are in the future`];
  }
  return p;
}

function findAnomalies(columns, rows) {
  const anomalies = [];
  columns.forEach((c, col) => {
    if (c.type !== 'integer' && c.type !== 'float') return;
    const nv = numericValues(rows, col);
    if (nv.length < 8) return;
    const vals = nv.map((x) => x.v);
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
    const m = S.mean(vals), sd = Math.sqrt(S.variance(vals));
    for (const { i, v } of nv) {
      const z = sd > 0 ? (v - m) / sd : 0;
      const iqrOut = iqr > 0 && (v < lowFence || v > highFence);
      const zOut = Math.abs(z) > 3;
      if (iqrOut || zOut) {
        anomalies.push({
          column: c.name, row: i + 2, // +2: 1-based + header line, matches what analysts see in Excel
          value: v, zScore: +z.toFixed(2),
          method: zOut && iqrOut ? 'IQR + z-score' : zOut ? 'z-score > 3' : 'outside IQR fence (1.5×)',
        });
      }
    }
  });
  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  return anomalies.slice(0, 50);
}

function findTestRows(columns, rows) {
  const hits = [];
  rows.forEach((r, i) => {
    if (r.some((cell) => TEST_ROW_RE.test(String(cell).trim()))) hits.push(i + 2);
  });
  return hits;
}

function correlationMatrix(columns, rows) {
  const numCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'integer' || c.type === 'float');
  const pairs = [];
  for (let a = 0; a < numCols.length; a++) {
    for (let b = a + 1; b < numCols.length; b++) {
      const xs = [], ys = [];
      for (const r of rows) {
        const x = toNumber(r[numCols[a].i]), y = toNumber(r[numCols[b].i]);
        if (x !== null && y !== null) { xs.push(x); ys.push(y); }
      }
      if (xs.length < 4) continue;
      const r = S.pearson(xs, ys);
      pairs.push({ col1: numCols[a].c.name, col2: numCols[b].c.name, r: +r.toFixed(3), n: xs.length });
    }
  }
  pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return pairs;
}

function countDuplicates(rows) {
  const seen = new Set();
  let dups = 0;
  for (const r of rows) {
    const key = r.join('');
    if (seen.has(key)) dups++;
    else seen.add(key);
  }
  return dups;
}

// Data-quality score: 100 minus weighted deductions
function qualityScore({ columns, rowCount, duplicates, testRows }) {
  const deductions = [];
  const totalNullPct = columns.length ? columns.reduce((a, c) => a + c.nullPct, 0) / columns.length : 0;
  if (totalNullPct > 0) deductions.push({ reason: `missing values (avg ${totalNullPct.toFixed(1)}% per column)`, points: Math.min(20, Math.round(totalNullPct)) });
  const mixedDates = columns.filter((c) => (c.flags || []).some((f) => f.startsWith('mixed date formats')));
  if (mixedDates.length) deductions.push({ reason: `mixed date formats in: ${mixedDates.map((c) => c.name).join(', ')}`, points: 10 * mixedDates.length });
  if (duplicates > 0) deductions.push({ reason: `${duplicates} duplicate row(s)`, points: Math.min(15, 3 + Math.round((duplicates / rowCount) * 100)) });
  const constants = columns.filter((c) => (c.flags || []).some((f) => f.startsWith('constant column')));
  if (constants.length) deductions.push({ reason: `constant column(s): ${constants.map((c) => c.name).join(', ')}`, points: 5 * constants.length });
  if (testRows.length) deductions.push({ reason: `${testRows.length} suspected test row(s) (e.g. "test", "asdf")`, points: Math.min(15, 2 * testRows.length) });
  const mixedNumeric = columns.filter((c) => (c.flags || []).some((f) => f.includes('non-numeric values')));
  if (mixedNumeric.length) deductions.push({ reason: `non-numeric noise in numeric column(s): ${mixedNumeric.map((c) => c.name).join(', ')}`, points: 5 * mixedNumeric.length });
  const futureDates = columns.filter((c) => (c.flags || []).some((f) => f.includes('in the future')));
  if (futureDates.length) deductions.push({ reason: `future dates in: ${futureDates.map((c) => c.name).join(', ')}`, points: 5 * futureDates.length });

  const total = deductions.reduce((a, d) => a + d.points, 0);
  return { score: Math.max(0, 100 - total), deductions };
}

// Scan categorical × numeric pairs for the strongest group difference (ANOVA)
function findGroupDifference(columns, rows) {
  const cats = columns.map((c, i) => ({ c, i }))
    .filter(({ c }) => (c.type === 'categorical' || c.type === 'boolean') && c.distinct >= 2 && c.distinct <= 8)
    .slice(0, 4);
  const nums = columns.map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === 'integer' || c.type === 'float')
    .slice(0, 3);
  let best = null;
  for (const { i: ni, c: nc } of nums) {
    // IQR fences per metric so a single extreme outlier can't mask real group effects
    const all = numericValues(rows, ni).map((x) => x.v).sort((a, b) => a - b);
    if (all.length < 20) continue;
    const q1 = all[Math.floor(all.length * 0.25)], q3 = all[Math.floor(all.length * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 3 * iqr, hi = q3 + 3 * iqr;
    for (const { c: gc, i: gi } of cats) {
      const groups = {};
      let trimmed = 0;
      for (const r of rows) {
        const g = String(r[gi]).trim();
        const v = toNumber(r[ni]);
        if (g === '' || v === null) continue;
        if (iqr > 0 && (v < lo || v > hi)) { trimmed++; continue; }
        (groups[g] = groups[g] || []).push(v);
      }
      for (const k of Object.keys(groups)) if (groups[k].length < 5) delete groups[k];
      if (Object.keys(groups).length < 2) continue;
      const res = S.oneWayANOVA(groups);
      if (res.error || !isFinite(res.p)) continue;
      if (!best || res.p < best.p) best = { p: res.p, metric: nc.name, groupCol: gc.name, groups: res.groups, trimmed };
    }
  }
  return best && best.p < 0.05 ? best : null;
}

// Plain-language auto-insights, computed locally
function buildInsights({ columns, anomalies, correlations, quality, duplicates, testRows, rowCount, groupDiff }) {
  const insights = [];
  if (anomalies.length) {
    const top = anomalies[0];
    insights.push(`Biggest outlier: ${top.column} = ${top.value} at row ${top.row} (z-score ${top.zScore}) — worth checking before averaging this column.`);
  }
  const strongCorr = correlations.find((c) => Math.abs(c.r) >= 0.5);
  if (strongCorr) {
    insights.push(`${strongCorr.col1} and ${strongCorr.col2} move together (r = ${strongCorr.r}, n = ${strongCorr.n}) — the strongest relationship in the data.`);
  }
  if (groupDiff) {
    const sorted = [...groupDiff.groups].sort((a, b) => b.mean - a.mean);
    const top = sorted[0], bot = sorted[sorted.length - 1];
    const p = groupDiff.p < 0.0001 ? '< 0.0001' : groupDiff.p.toFixed(4);
    const trim = groupDiff.trimmed ? `, ${groupDiff.trimmed} outlier(s) excluded` : '';
    insights.push(`${groupDiff.metric} differs significantly across ${groupDiff.groupCol} (ANOVA p ${p}${trim}): ${top.group} averages ${top.mean.toFixed(1)} vs ${bot.group} at ${bot.mean.toFixed(1)} — worth a closer look.`);
  }
  if (quality.deductions.length) {
    const worst = [...quality.deductions].sort((a, b) => b.points - a.points)[0];
    insights.push(`Top quality issue: ${worst.reason} (−${worst.points} points).`);
  }
  if (testRows.length) insights.push(`${testRows.length} row(s) look like test data (rows ${testRows.slice(0, 5).join(', ')}${testRows.length > 5 ? '…' : ''}) — consider excluding them from analysis.`);
  if (duplicates > 0) insights.push(`${duplicates} exact duplicate row(s) found out of ${rowCount} — dedupe before counting.`);
  const skewed = columns.find((c) => Math.abs(c.skewness || 0) > 2);
  if (skewed) insights.push(`${skewed.name} is heavily skewed (skewness ${skewed.skewness}) — median (${skewed.median}) is more trustworthy than mean (${skewed.mean}).`);
  return insights.slice(0, 6);
}

function buildProfile(headers, rows) {
  const types = inferTypes(headers, rows);
  const columns = types.map((c, i) => profileColumn(c, rows, i, rows.length));
  const anomalies = findAnomalies(columns, rows);
  const correlations = correlationMatrix(columns, rows);
  const duplicates = countDuplicates(rows);
  const testRows = findTestRows(columns, rows);
  const quality = qualityScore({ columns, rowCount: rows.length, duplicates, testRows });
  const groupDiff = findGroupDifference(columns, rows);
  const insights = buildInsights({ columns, anomalies, correlations, quality, duplicates, testRows, rowCount: rows.length, groupDiff });
  return { rowCount: rows.length, columnCount: headers.length, columns, anomalies, correlations, duplicates, testRows, quality, insights };
}

module.exports = { buildProfile };
