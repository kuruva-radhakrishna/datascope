'use strict';

// Chat orchestration. Two-step flow when the Bifrost gateway is available:
//   1) LLM turns the question into a structured intent JSON
//   2) backend runs the math locally (analysis.js), LLM narrates the numbers
// The model only ever sees schema + profile aggregates — never raw rows.
// Without a key (or on any gateway error) a rule-based fallback handles
// common question shapes with templated interpretations.

const { runIntent } = require('./analysis.js');

const GATEWAY_URL = process.env.BIFROST_URL || 'https://gateway-buildathon.ltl.sh/v1/chat/completions';
const MODEL = process.env.BIFROST_MODEL || 'gpt-4o';

function llmConfigured() { return Boolean(process.env.BIFROST_API_KEY); }

async function callLLM(messages, { maxTokens = 500, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.BIFROST_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.2 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`gateway HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('gateway returned no content');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Compact context: schema + per-column summaries + quality flags. No raw rows.
function datasetContext(dataset) {
  const cols = dataset.profile.columns.map((c) => {
    const base = { name: c.name, type: c.type, nullPct: c.nullPct };
    if (c.mean !== undefined) Object.assign(base, { min: c.min, max: c.max, mean: c.mean, median: c.median, stddev: c.stddev });
    if (c.topValues) base.topValues = c.topValues.slice(0, 6).map((t) => t.value);
    if (c.flags && c.flags.length) base.flags = c.flags;
    return base;
  });
  return {
    name: dataset.name,
    rowCount: dataset.rowCount,
    columns: cols,
    qualityScore: dataset.profile.quality.score,
    insights: dataset.profile.insights,
  };
}

const INTENT_INSTRUCTIONS = `You translate an analyst's question about a dataset into ONE JSON intent. Reply with ONLY the JSON object, no prose, no markdown fences.
Possible intents:
{"action":"ttest","metric":"<numeric col>","groupCol":"<categorical col>","groups":["A","B"]}  — compare a numeric metric between exactly 2 groups (omit "groups" to use the 2 largest)
{"action":"chisq","col1":"<categorical col>","col2":"<categorical col>"}  — association between two categorical columns (use this for rate/proportion differences, e.g. return rate by courier)
{"action":"anova","metric":"<numeric col>","groupCol":"<categorical col>"}  — compare a numeric metric across 3+ groups
{"action":"correlation","col1":"<numeric col>","col2":"<numeric col>"}  — relationship between two numeric columns
{"action":"aggregate","groupBy":"<categorical col>","agg":"mean|sum|count","metric":"<numeric col or null>","topN":10}  — rankings, totals, averages, distributions
{"action":"answer","text":"<direct answer>"}  — only when the question is fully answerable from the provided profile (e.g. about data quality, nulls, columns)
Any test intent may also include "trim": true to exclude extreme outliers (3×IQR) — use it when the profile flags big outliers in the metric.
Use exact column names from the schema.`;

async function llmIntent(dataset, question, history) {
  const ctx = datasetContext(dataset);
  const messages = [
    { role: 'system', content: `${INTENT_INSTRUCTIONS}\n\nDataset profile:\n${JSON.stringify(ctx)}` },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];
  const text = await callLLM(messages, { maxTokens: 200 });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in intent response');
  return JSON.parse(match[0]);
}

async function llmInterpret(dataset, question, intent, result) {
  const messages = [
    {
      role: 'system',
      content: 'You are a careful data analyst. The statistical result below was computed deterministically by the backend — do not recompute or invent numbers. Reply with 3-5 crisp bullet points, each on its own line starting with "• ", max ~14 words each: what was tested, the key numbers (p-value, effect size), the plain-language verdict, and one caveat if relevant. No paragraphs, no preamble, no markdown headers.',
    },
    {
      role: 'user',
      content: `Question: ${question}\nDataset: ${dataset.name} (${dataset.rowCount} rows)\nIntent: ${JSON.stringify(intent)}\nComputed result: ${JSON.stringify(result)}`,
    },
  ];
  return callLLM(messages, { maxTokens: 350 });
}

// ---------- rule-based fallback ----------

function findMentionedColumns(dataset, question) {
  const q = question.toLowerCase();
  const found = [];
  for (const c of dataset.profile.columns) {
    const n = c.name.toLowerCase();
    if (q.includes(n) || (n === 'price' && (q.includes('aov') || q.includes('value'))) ||
        (n === 'returned' && q.includes('return'))) {
      found.push(c);
    }
  }
  return found;
}

function isNumericCol(c) { return c.type === 'integer' || c.type === 'float'; }
function isCategoricalCol(c) { return c.type === 'categorical' || c.type === 'boolean'; }

// "Karnataka vs Maharashtra" — group VALUES mentioned instead of a column name
function findMentionedGroups(dataset, question) {
  const q = question.toLowerCase();
  for (const c of dataset.profile.columns) {
    if (!isCategoricalCol(c) || !c.topValues) continue;
    const hits = c.topValues
      .filter((t) => t.value.length >= 3 && q.includes(t.value.toLowerCase()))
      .map((t) => t.value);
    if (hits.length >= 2) return { col: c, groups: hits.slice(0, 2) };
  }
  return null;
}

function ruleIntent(dataset, question) {
  const q = question.toLowerCase();
  const cols = findMentionedColumns(dataset, question);
  const numeric = cols.filter(isNumericCol);
  const categorical = cols.filter(isCategoricalCol);

  const topMatch = q.match(/top\s+(\d+)/);
  if (topMatch && categorical.length) {
    return { action: 'aggregate', groupBy: categorical[0].name, agg: numeric.length ? 'mean' : 'count', metric: numeric[0] ? numeric[0].name : null, topN: +topMatch[1] };
  }
  if (/(correlat|relationship|related)/.test(q) && numeric.length >= 2) {
    return { action: 'correlation', col1: numeric[0].name, col2: numeric[1].name };
  }
  if (/(differ|difference|compare|versus|\bvs\b|between|higher|lower|more|less)/.test(q)) {
    const mentioned = findMentionedGroups(dataset, question);
    if (numeric.length >= 1 && mentioned) {
      return { action: 'ttest', metric: numeric[0].name, groupCol: mentioned.col.name, groups: mentioned.groups };
    }
    if (numeric.length >= 1 && categorical.length >= 1) {
      const groupCount = categorical[0].distinct;
      if (groupCount > 2) return { action: 'anova', metric: numeric[0].name, groupCol: categorical[0].name };
      return { action: 'ttest', metric: numeric[0].name, groupCol: categorical[0].name };
    }
    if (categorical.length >= 2) {
      // rate/share questions between two categoricals => chi-square
      return { action: 'chisq', col1: categorical[0].name, col2: categorical[1].name };
    }
  }
  if (/(distribution|breakdown|split|share)/.test(q) && categorical.length) {
    return { action: 'aggregate', groupBy: categorical[0].name, agg: 'count', metric: null, topN: 10 };
  }
  if (/(average|mean|total|sum|count)/.test(q) && categorical.length) {
    const agg = /(total|sum)/.test(q) ? 'sum' : /(count|how many)/.test(q) ? 'count' : 'mean';
    return { action: 'aggregate', groupBy: categorical[0].name, agg, metric: numeric[0] ? numeric[0].name : null, topN: 10 };
  }
  if (/(quality|clean|issue|problem|flag)/.test(q)) {
    const ded = dataset.profile.quality.deductions.map((d) => `${d.reason} (−${d.points})`).join('; ');
    return { action: 'answer', text: `Data quality score: ${dataset.profile.quality.score}/100.${ded ? ' Issues: ' + ded : ' No issues detected.'}` };
  }
  return {
    action: 'answer',
    text: `I can run these on "${dataset.name}": compare a metric between groups (t-test/ANOVA), check if two categories are related (chi-square), correlations, and top-N breakdowns. Try: "Is price different between Karnataka and Maharashtra?" or "Top 5 states by price".`,
  };
}

function fmtP(p) { return p < 0.0001 ? '< 0.0001' : p.toFixed(4); }

function templateInterpretation(result) {
  if (result.error) return `I couldn't run that: ${result.error}`;
  const sig = (p) => (p < 0.05 ? 'statistically significant at 95%' : 'not statistically significant');
  const lines = [];
  switch (result.test) {
    case 'welch-t': {
      const d = Math.abs(result.cohenD);
      const size = d < 0.2 ? 'negligible' : d < 0.5 ? 'small' : d < 0.8 ? 'medium' : 'large';
      lines.push(
        `• Welch's t-test: ${result.metric} — ${result.group1} vs ${result.group2}`,
        `• ${result.group1} mean ${result.mean1.toFixed(2)} (n=${result.n1}) vs ${result.group2} ${result.mean2.toFixed(2)} (n=${result.n2})`,
        `• p = ${fmtP(result.p)} — ${sig(result.p)}`,
        `• Effect size: ${size} (Cohen's d = ${result.cohenD.toFixed(2)})`,
      );
      break;
    }
    case 'chi-square': {
      lines.push(
        `• Chi-square: ${result.col1} × ${result.col2} (n=${result.n})`,
        `• χ² = ${result.chi2.toFixed(2)}, df = ${result.df}, p = ${fmtP(result.p)}`,
        `• Verdict: ${result.p < 0.05 ? `${result.col2} rates genuinely differ across ${result.col1}` : 'differences could plausibly be chance'}`,
      );
      if (result.warning) lines.push(`• ⚠ ${result.warning}`);
      break;
    }
    case 'anova': {
      const sorted = [...result.groups].sort((a, b) => b.mean - a.mean);
      lines.push(
        `• One-way ANOVA: ${result.metric} across ${result.k} groups of ${result.groupCol}`,
        `• F(${result.df1}, ${result.df2}) = ${result.F.toFixed(3)}, p = ${fmtP(result.p)} — ${sig(result.p)}`,
        `• Highest: ${sorted[0].group} (${sorted[0].mean.toFixed(1)}) · lowest: ${sorted[sorted.length - 1].group} (${sorted[sorted.length - 1].mean.toFixed(1)})`,
      );
      if (result.note) lines.push(`• ${result.note}`);
      break;
    }
    case 'correlation': {
      const strength = Math.abs(result.r) < 0.3 ? 'weak' : Math.abs(result.r) < 0.6 ? 'moderate' : 'strong';
      lines.push(
        `• Pearson correlation: ${result.col1} × ${result.col2}`,
        `• r = ${result.r.toFixed(3)} (n=${result.n}) — a ${strength} ${result.r >= 0 ? 'positive' : 'negative'} relationship`,
        `• p = ${fmtP(result.p)} — ${sig(result.p)}`,
      );
      break;
    }
    case 'aggregate': {
      const what = result.agg === 'count' ? 'Count' : `${result.agg[0].toUpperCase()}${result.agg.slice(1)} of ${result.metric}`;
      lines.push(`• ${what} by ${result.groupBy}:`);
      for (const r of result.results.slice(0, 6)) {
        lines.push(`• ${r.group}: ${typeof r.value === 'number' ? r.value.toLocaleString() : r.value}${result.agg === 'count' ? '' : ` (n=${r.n})`}`);
      }
      break;
    }
    default:
      return JSON.stringify(result);
  }
  if (result.trimmed) lines.push(`• ${result.trimmed} extreme outlier(s) excluded for robustness (3×IQR rule)`);
  return lines.join('\n');
}

// ---------- main entry ----------

async function answerQuestion(dataset, rows, question, history) {
  let intent = null;
  let mode = 'fallback';

  if (llmConfigured()) {
    try {
      intent = await llmIntent(dataset, question, history);
      mode = 'llm';
    } catch (err) {
      console.error('LLM intent failed, falling back to rules:', err.message);
    }
  }
  if (!intent) intent = ruleIntent(dataset, question);

  if (intent.action === 'answer') {
    return { answer: intent.text || 'See the profile panel for details.', intent, result: null, mode };
  }

  const result = runIntent(dataset.headers, rows, intent);

  let answer;
  if (mode === 'llm' && !result.error) {
    try {
      answer = await llmInterpret(dataset, question, intent, result);
    } catch (err) {
      console.error('LLM interpretation failed, using template:', err.message);
      answer = templateInterpretation(result);
      mode = 'llm-intent+template';
    }
  } else {
    answer = templateInterpretation(result);
  }
  return { answer, intent, result, mode };
}

module.exports = { answerQuestion, llmConfigured, datasetContext, templateInterpretation };
