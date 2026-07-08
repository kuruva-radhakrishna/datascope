import React, { useEffect, useRef, useState } from 'react';
import { Histogram, BarChart, ScoreRing, GroupMeansChart, RateBars, ScatterPlot } from './charts.jsx';
import { api } from './api.js';

const TYPE_ICONS = { integer: '#', float: '#', date: '📅', boolean: '◑', categorical: '▤', text: 'Aa' };

// pandas-style df.head() preview, pinned above everything else
export function DataHead({ dataset }) {
  const [n, setN] = useState(10);
  const [head, setHead] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getHead(dataset.id, n).then((d) => { if (!cancelled) setHead(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [dataset.id, n]);

  const download = async () => {
    setBusy(true);
    try { await api.downloadHeadXlsx(dataset.id, dataset.name, n); } finally { setBusy(false); }
  };

  return (
    <div className="card head-card">
      <div className="head-toolbar">
        <h3>🐼 df.head({n})</h3>
        <div className="head-controls">
          <select value={n} onChange={(e) => setN(Number(e.target.value))}>
            {[5, 10, 20, 50].map((v) => <option key={v} value={v}>{v} rows</option>)}
          </select>
          <button className="btn btn-xlsx" onClick={download} disabled={busy}>⬇ Excel</button>
        </div>
      </div>
      {!head ? <p className="muted">Loading…</p> : (
        <div className="head-table-wrap">
          <table className="table head-table">
            <thead><tr><th className="idx-col">#</th>{head.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {head.rows.map((r, i) => (
                <tr key={i}><td className="idx-col muted">{i}</td>{r.map((c, j) => <td key={j}>{c === '' ? <span className="muted">∅</span> : c}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="muted small head-footer">{head.totalRows} rows × {head.headers.length} columns</p>
        </div>
      )}
    </div>
  );
}

export function DatasetList({ datasets, selectedId, onSelect, onUpload, onDelete, uploading }) {
  const fileRef = useRef(null);
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert('This file is over the 4MB upload cap. Try a smaller extract.');
      return;
    }
    onUpload(file.name, await file.text());
  };
  return (
    <aside className="pane pane-left">
      <button className="btn btn-primary btn-block" onClick={() => fileRef.current.click()} disabled={uploading}>
        {uploading ? 'Profiling…' : '＋ Upload CSV'}
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
      <div className="dataset-list">
        {datasets.map((d) => (
          <div
            key={d.id}
            className={`dataset-item ${d.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <div className="dataset-name">{d.name}</div>
            <div className="dataset-meta">
              {d.rowCount} rows · {d.columnCount} cols
              {typeof d.qualityScore === 'number' && <span className={`chip-score s${d.qualityScore >= 80 ? 'good' : d.qualityScore >= 55 ? 'warn' : 'bad'}`}>{d.qualityScore}</span>}
            </div>
            {!d.name.includes('(demo)') && <button className="btn-x" title="Delete dataset" onClick={(e) => { e.stopPropagation(); onDelete(d.id); }}>×</button>}
          </div>
        ))}
        {datasets.length === 0 && <p className="muted">No datasets yet — upload a CSV to begin.</p>}
      </div>
      <a className="seed-link" href="/api/seed.csv" download="meesho_orders.csv">⬇ download demo CSV</a>
    </aside>
  );
}

export function QualityHeader({ dataset }) {
  const q = dataset.profile.quality;
  return (
    <div className="card quality-card">
      <ScoreRing score={q.score} />
      <div className="quality-body">
        <div className="quality-title">
          <h2>{dataset.name}</h2>
          <a
            className="btn btn-report"
            href={`/api/datasets/${dataset.id}/report`}
            download={`${dataset.name.replace(/[^a-z0-9._-]/gi, '_')}-report.html`}
          >⬇ Download report</a>
        </div>
        <p className="muted">{dataset.rowCount} rows · {dataset.columnCount} columns · data-quality score</p>
        {q.deductions.length > 0 ? (
          <ul className="deductions">
            {q.deductions.map((d, i) => <li key={i}><span className="ded-points">−{d.points}</span> {d.reason}</li>)}
          </ul>
        ) : <p className="good-text">No quality issues detected.</p>}
      </div>
    </div>
  );
}

export function Insights({ insights }) {
  if (!insights || !insights.length) return null;
  return (
    <div className="card insights-card">
      <h3>⚡ Auto-insights</h3>
      <ul>{insights.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  );
}

export function ColumnCard({ col, rowCount }) {
  return (
    <div className="card col-card">
      <div className="col-head">
        <span className="col-type" title={col.type}>{TYPE_ICONS[col.type] || '?'}</span>
        <strong>{col.name}</strong>
        <span className="muted col-tag">{col.type}</span>
      </div>
      <div className="col-stats">
        <span>{col.nullPct}% null</span>
        <span>{col.distinct} distinct</span>
        {col.mean !== undefined && <>
          <span>μ {col.mean}</span>
          <span>med {col.median}</span>
          <span>σ {col.stddev}</span>
          <span>[{col.min} … {col.max}]</span>
          {Math.abs(col.skewness) > 1 && <span>skew {col.skewness}</span>}
        </>}
        {col.dateMin && <span>{col.dateMin} → {col.dateMax}</span>}
      </div>
      {col.histogram && <Histogram bins={col.histogram} />}
      {col.topValues && <BarChart items={col.topValues.slice(0, 5)} total={rowCount} />}
      {col.flags && col.flags.length > 0 && (
        <div className="flags">{col.flags.map((f, i) => <span key={i} className="flag">⚠ {f}</span>)}</div>
      )}
    </div>
  );
}

export function Anomalies({ anomalies }) {
  const [open, setOpen] = useState(false);
  if (!anomalies.length) return null;
  const shown = open ? anomalies : anomalies.slice(0, 5);
  return (
    <div className="card">
      <h3>🚨 Anomalies <span className="muted">({anomalies.length})</span></h3>
      <table className="table">
        <thead><tr><th>Column</th><th>Row</th><th>Value</th><th>z-score</th><th>Method</th></tr></thead>
        <tbody>
          {shown.map((a, i) => (
            <tr key={i}>
              <td>{a.column}</td><td>{a.row}</td><td className="mono">{a.value}</td>
              <td className="mono">{a.zScore}</td><td className="muted">{a.method}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {anomalies.length > 5 && (
        <button className="btn btn-ghost" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `Show all ${anomalies.length}`}</button>
      )}
    </div>
  );
}

export function Correlations({ correlations }) {
  const strong = correlations.filter((c) => Math.abs(c.r) >= 0.1).slice(0, 6);
  if (!strong.length) return null;
  return (
    <div className="card">
      <h3>🔗 Correlations</h3>
      {strong.map((c, i) => (
        <div key={i} className="corr-row">
          <span>{c.col1} × {c.col2}</span>
          <div className="corr-track"><div className={`corr-fill ${c.r < 0 ? 'neg' : ''}`} style={{ width: `${Math.abs(c.r) * 100}%` }} /></div>
          <span className="mono">r = {c.r}</span>
        </div>
      ))}
    </div>
  );
}

function fmtP(p) { return p < 0.0001 ? '< 0.0001' : p.toFixed(4); }

// Chart for any computed test result — shared by the Run-a-test card and chat analysis
export function TestVisualization({ result }) {
  if (!result || result.error) return null;
  if (result.test === 'welch-t') {
    return <GroupMeansChart groups={[
      { label: result.group1, mean: result.mean1, sd: result.sd1, n: result.n1 },
      { label: result.group2, mean: result.mean2, sd: result.sd2, n: result.n2 },
    ]} />;
  }
  if (result.test === 'anova') {
    return <GroupMeansChart groups={result.groups.map((g) => ({ label: g.group, mean: g.mean, sd: g.sd, n: g.n }))} />;
  }
  if (result.test === 'chi-square') return <RateBars table={result.table} colCats={result.colCats} />;
  if (result.test === 'correlation') return <ScatterPlot points={result.points} col1={result.col1} col2={result.col2} />;
  if (result.test === 'aggregate') {
    return <BarChart items={result.results.map((r) => ({ value: r.group, count: r.value }))} />;
  }
  return null;
}

function statChips(result) {
  switch (result.test) {
    case 'welch-t': return [['t', result.t.toFixed(3)], ['df', result.df.toFixed(1)], ['p', fmtP(result.p)], ["Cohen's d", result.cohenD.toFixed(2)]];
    case 'chi-square': return [['χ²', result.chi2.toFixed(2)], ['df', result.df], ['p', fmtP(result.p)], ['n', result.n]];
    case 'anova': return [['F', result.F.toFixed(3)], ['df', `${result.df1}, ${result.df2}`], ['p', fmtP(result.p)]];
    case 'correlation': return [['r', result.r.toFixed(3)], ['n', result.n], ['p', fmtP(result.p)]];
    default: return [];
  }
}

const TEST_NAMES = {
  'welch-t': "Welch's t-test", 'chi-square': 'Chi-square test', anova: 'One-way ANOVA',
  correlation: 'Pearson correlation', aggregate: 'Aggregation',
};

function ExcelButton({ question, result }) {
  const [busy, setBusy] = useState(false);
  const download = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try { await api.downloadResultXlsx(question, result); } finally { setBusy(false); }
  };
  return <button className="btn btn-xlsx" onClick={download} disabled={busy} title="Download this analysis as an Excel workbook">⬇ Excel</button>;
}

// Rich card shown at the top of the center pane when a chat answer ran a test
export function ChatAnalysisCard({ item, onClose }) {
  const { question, answer, result, mode } = item;
  if (!result || result.error) return null;
  const sig = result.p !== undefined ? result.p < 0.05 : null;
  return (
    <div className="card chat-analysis">
      <div className="ca-head">
        <h3>📊 {TEST_NAMES[result.test] || 'Analysis'} <span className="ca-from">from chat</span></h3>
        <div className="ca-badges">
          <span className="local-badge" title="Statistics are computed by the backend, never by the AI">🔒 computed locally</span>
          <span className={`mode-badge ${mode === 'llm' ? 'llm' : 'rule'}`}>{mode === 'llm' ? 'AI narrated' : mode === 'demo' ? 'worked example' : 'offline'}</span>
          <ExcelButton question={question} result={result} />
          <button className="btn-x ca-close" title="Dismiss" onClick={onClose}>×</button>
        </div>
      </div>
      {question && <p className="ca-question">“{question}”</p>}
      <TestVisualization result={result} />
      <div className="stat-chips">
        {statChips(result).map(([k, v]) => <span key={k} className="stat-chip"><em>{k}</em> {v}</span>)}
        {sig !== null && <span className={`sig-badge ${sig ? 'yes' : 'no'}`}>{sig ? 'significant at 95%' : 'not significant'}</span>}
      </div>
      <p className="ca-answer">{answer}</p>
      {result.warning && <div className="flag">⚠ {result.warning}</div>}
    </div>
  );
}

export function ResultCard({ result, question }) {
  if (!result) return null;
  if (result.error) return <div className="result result-err">⚠ {result.error}</div>;
  const sig = result.p !== undefined ? result.p < 0.05 : null;
  return (
    <div className={`result ${sig === null ? '' : sig ? 'result-sig' : 'result-ns'}`}>
      <div className="result-toolbar"><ExcelButton question={question} result={result} /></div>
      {result.test === 'welch-t' && <>
        <strong>Welch's t-test — {result.metric} by {result.groupCol}</strong>
        <div className="result-grid">
          <span>{result.group1}: μ {result.mean1.toFixed(2)} (n={result.n1})</span>
          <span>{result.group2}: μ {result.mean2.toFixed(2)} (n={result.n2})</span>
          <span>t = {result.t.toFixed(3)}</span><span>df = {result.df.toFixed(1)}</span>
          <span className="p-val">p = {fmtP(result.p)}</span><span>Cohen's d = {result.cohenD.toFixed(2)}</span>
        </div>
      </>}
      {result.test === 'chi-square' && <>
        <strong>Chi-square — {result.col1} × {result.col2}</strong>
        <div className="result-grid">
          <span>χ² = {result.chi2.toFixed(2)}</span><span>df = {result.df}</span>
          <span className="p-val">p = {fmtP(result.p)}</span><span>n = {result.n}</span>
        </div>
        {result.warning && <div className="flag">⚠ {result.warning}</div>}
      </>}
      {result.test === 'anova' && <>
        <strong>ANOVA — {result.metric} across {result.k} groups of {result.groupCol}</strong>
        <div className="result-grid">
          <span>F({result.df1}, {result.df2}) = {result.F.toFixed(3)}</span>
          <span className="p-val">p = {fmtP(result.p)}</span>
        </div>
        <div className="muted small">{result.groups.map((g) => `${g.group}: μ ${g.mean.toFixed(1)} (n=${g.n})`).join(' · ')}</div>
      </>}
      {result.test === 'correlation' && <>
        <strong>Correlation — {result.col1} × {result.col2}</strong>
        <div className="result-grid">
          <span>r = {result.r.toFixed(3)}</span><span>n = {result.n}</span>
          <span className="p-val">p = {fmtP(result.p)}</span>
        </div>
      </>}
      {result.test === 'aggregate' && (
        <strong>{result.agg} {result.metric ? `of ${result.metric}` : ''} by {result.groupBy}</strong>
      )}
      <TestVisualization result={result} />
      {sig !== null && <div className={`sig-badge ${sig ? 'yes' : 'no'}`}>{sig ? 'significant at 95%' : 'not significant'}</div>}
    </div>
  );
}

export function TestForm({ dataset, onResult }) {
  const cols = dataset.profile.columns;
  const numeric = cols.filter((c) => c.type === 'integer' || c.type === 'float');
  const categorical = cols.filter((c) => c.type === 'categorical' || c.type === 'boolean');
  const [action, setAction] = useState('ttest');
  const [metric, setMetric] = useState(numeric[0]?.name || '');
  const [groupCol, setGroupCol] = useState(categorical[0]?.name || '');
  const [col2, setCol2] = useState(categorical[1]?.name || '');
  const [num2, setNum2] = useState(numeric[1]?.name || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMetric(numeric[0]?.name || '');
    setGroupCol(categorical[0]?.name || '');
    setCol2(categorical[1]?.name || '');
    setNum2(numeric[1]?.name || '');
  }, [dataset.id]);

  const run = async () => {
    setBusy(true);
    try {
      const params =
        action === 'ttest' || action === 'anova' ? { action, metric, groupCol }
        : action === 'chisq' ? { action, col1: groupCol, col2 }
        : { action, col1: metric, col2: num2 };
      const question =
        action === 'ttest' || action === 'anova' ? `${metric} by ${groupCol}`
        : action === 'chisq' ? `${groupCol} × ${col2}`
        : `${metric} × ${num2}`;
      const result = await api.runTest(dataset.id, params).catch((e) => ({ error: e.message }));
      onResult(result, question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>🧪 Run a test</h3>
      <div className="form-row">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="ttest">t-test (2 groups)</option>
          <option value="anova">ANOVA (3+ groups)</option>
          <option value="chisq">chi-square (category × category)</option>
          <option value="correlation">correlation (number × number)</option>
        </select>
        {(action === 'ttest' || action === 'anova') && <>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {numeric.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <span className="muted">by</span>
          <select value={groupCol} onChange={(e) => setGroupCol(e.target.value)}>
            {categorical.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </>}
        {action === 'chisq' && <>
          <select value={groupCol} onChange={(e) => setGroupCol(e.target.value)}>
            {categorical.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <span className="muted">×</span>
          <select value={col2} onChange={(e) => setCol2(e.target.value)}>
            {categorical.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </>}
        {action === 'correlation' && <>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {numeric.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <span className="muted">×</span>
          <select value={num2} onChange={(e) => setNum2(e.target.value)}>
            {numeric.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </>}
        <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
      </div>
    </div>
  );
}

const DEFAULT_CHIPS = [
  'Is return rate different between couriers?',
  'Compare price between Karnataka and Maharashtra',
  'Is shipping fee related to price?',
  'What are the data quality issues?',
];

export function ChatPanel({ dataset, messages, onSend, busy, llmMode, onVisualize }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const suggestions = dataset?.suggestions || DEFAULT_CHIPS;

  const send = (text) => {
    const q = (text || input).trim();
    if (!q || busy) return;
    setInput('');
    onSend(q);
  };

  return (
    <aside className="pane pane-right">
      <div className="chat-head">
        <h3>💬 Ask the data</h3>
        <span className={`mode-badge ${llmMode === 'bifrost' ? 'llm' : 'rule'}`}>
          {llmMode === 'bifrost' ? 'AI mode' : 'offline mode'}
        </span>
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="muted chat-hint">Ask a question about <strong>{dataset ? dataset.name : 'the data'}</strong>. The statistics are computed locally — the AI only narrates them.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <div className="msg-body">{m.content}</div>
            {m.role === 'assistant' && m.intent && m.intent.action !== 'answer' && (
              <span className="test-badge">
                ran: {m.intent.action}{m.result && m.result.p !== undefined ? ` · p = ${m.result.p < 0.0001 ? '<0.0001' : m.result.p.toFixed(4)}` : ''}
                {m.result && !m.result.error && (
                  <button
                    className="viz-btn" title="Show this analysis as a chart"
                    onClick={() => onVisualize({
                      question: messages[i - 1] && messages[i - 1].role === 'user' ? messages[i - 1].content : '',
                      answer: m.content, intent: m.intent, result: m.result, mode: m.mode,
                    })}
                  >📊 visualize</button>
                )}
              </span>
            )}
          </div>
        ))}
        {busy && <div className="msg msg-assistant"><div className="msg-body typing">analyzing…</div></div>}
      </div>
      <div className="chips">
        {suggestions.map((c) => (
          <button key={c} className="chip" onClick={() => send(c)} disabled={busy || !dataset}>{c}</button>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={input}
          placeholder="e.g. compare price by state"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          disabled={busy || !dataset}
        />
        <button className="btn btn-primary" onClick={() => send()} disabled={busy || !dataset}>➤</button>
      </div>
    </aside>
  );
}
