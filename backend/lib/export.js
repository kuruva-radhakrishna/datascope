'use strict';

// Turns a dataset's head rows or a computed test result into xlsx sheets.
// Kept separate from xlsx.js (generic zip/OOXML writer) so this file is the
// only place that knows about DataScope's result shapes.

// Numeric-looking but preserves leading-zero codes (pincodes, IDs) as text —
// matches the spirit of the type inference used for profiling.
function isNumericLike(s) {
  const t = String(s).trim();
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return false;
  const intPart = t.replace(/^[+-]/, '').split('.')[0];
  return !(intPart.length > 1 && intPart[0] === '0');
}

function headSheets(dataset, rows, n) {
  const head = rows.slice(0, n);
  return [{ name: 'head', rows: [dataset.headers, ...head.map((r) => r.map((c) => (isNumericLike(c) ? Number(c) : c)))] }];
}

function resultSheets(question, result) {
  const summary = [['Question', question || '']];
  const sig = (p) => (p === undefined ? '' : p < 0.05 ? 'Yes' : 'No');

  switch (result.test) {
    case 'welch-t': {
      summary.push(
        ['Test', "Welch's two-sample t-test"],
        ['Metric', result.metric], ['Group column', result.groupCol],
        ['t', result.t], ['df', result.df], ['p-value', result.p],
        ["Cohen's d", result.cohenD], ['Significant (p<0.05)', sig(result.p)],
      );
      const data = [['Group', 'n', 'Mean', 'Std dev'],
        [result.group1, result.n1, result.mean1, result.sd1],
        [result.group2, result.n2, result.mean2, result.sd2]];
      return [{ name: 'summary', rows: summary }, { name: 'groups', rows: data }];
    }
    case 'anova': {
      summary.push(
        ['Test', 'One-way ANOVA'], ['Metric', result.metric], ['Group column', result.groupCol],
        ['F', result.F], ['df1', result.df1], ['df2', result.df2], ['p-value', result.p],
        ['Significant (p<0.05)', sig(result.p)],
      );
      const data = [['Group', 'n', 'Mean', 'Std dev'], ...result.groups.map((g) => [g.group, g.n, g.mean, g.sd])];
      return [{ name: 'summary', rows: summary }, { name: 'groups', rows: data }];
    }
    case 'chi-square': {
      summary.push(
        ['Test', 'Chi-square test of independence'], ['Column 1', result.col1], ['Column 2', result.col2],
        ['Chi-square', result.chi2], ['df', result.df], ['p-value', result.p],
        ['Significant (p<0.05)', sig(result.p)], ['Warning', result.warning || ''],
      );
      const header = ['Category', ...result.colCats];
      const data = [header, ...result.table.map((r) => [r.category, ...r.cells.map((c) => c.observed)])];
      const expected = [header, ...result.table.map((r) => [r.category, ...r.cells.map((c) => c.expected)])];
      return [{ name: 'summary', rows: summary }, { name: 'observed', rows: data }, { name: 'expected', rows: expected }];
    }
    case 'correlation': {
      summary.push(
        ['Test', 'Pearson correlation'], ['Column 1', result.col1], ['Column 2', result.col2],
        ['r', result.r], ['n', result.n], ['p-value', result.p], ['Significant (p<0.05)', sig(result.p)],
      );
      const data = [[result.col1, result.col2], ...(result.points || [])];
      return [{ name: 'summary', rows: summary }, { name: 'points', rows: data }];
    }
    case 'aggregate': {
      summary.push(['Test', 'Aggregation'], ['Group by', result.groupBy], ['Aggregate', result.agg], ['Metric', result.metric || 'count']);
      const data = [['Group', 'Value', 'n'], ...result.results.map((r) => [r.group, r.value, r.n])];
      return [{ name: 'summary', rows: summary }, { name: 'results', rows: data }];
    }
    default:
      return [{ name: 'summary', rows: summary.concat([['Raw', JSON.stringify(result)]]) }];
  }
}

module.exports = { headSheets, resultSheets };
