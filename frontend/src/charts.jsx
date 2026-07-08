import React from 'react';

// Hand-rolled SVG charts — no chart library, works fully offline.

export function Histogram({ bins }) {
  if (!bins || !bins.length) return null;
  const W = 240, H = 70, PAD = 2;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const bw = (W - PAD * 2) / bins.length;
  return (
    <svg width={W} height={H} className="chart" role="img" aria-label="histogram">
      {bins.map((b, i) => {
        const h = Math.max(1, (b.count / max) * (H - 14));
        return (
          <g key={i}>
            <rect
              x={PAD + i * bw + 1} y={H - h - 12} width={Math.max(1, bw - 2)} height={h}
              rx="1.5" className="bar"
            >
              <title>{`${b.x0} – ${b.x1}: ${b.count} rows`}</title>
            </rect>
          </g>
        );
      })}
      <text x={PAD} y={H - 2} className="chart-label">{bins[0].x0}</text>
      <text x={W - PAD} y={H - 2} className="chart-label" textAnchor="end">{bins[bins.length - 1].x1}</text>
    </svg>
  );
}

export function BarChart({ items, total }) {
  if (!items || !items.length) return null;
  const max = Math.max(...items.map((t) => t.count), 1);
  return (
    <div className="barchart">
      {items.map((t) => (
        <div key={t.value} className="barchart-row" title={`${t.value}: ${t.count}`}>
          <span className="barchart-label">{t.value}</span>
          <div className="barchart-track">
            <div className="barchart-fill" style={{ width: `${(t.count / max) * 100}%` }} />
          </div>
          <span className="barchart-count">{t.count}{total ? ` (${Math.round((t.count / total) * 100)}%)` : ''}</span>
        </div>
      ))}
    </div>
  );
}

// Vertical bars of group means with ±1 SD error bars (t-test / ANOVA results)
export function GroupMeansChart({ groups }) {
  if (!groups || !groups.length) return null;
  const W = 460, H = 190, PADL = 8, PADB = 34, PADT = 16;
  const shown = groups.slice(0, 8);
  const max = Math.max(...shown.map((g) => g.mean + (g.sd || 0)), 1);
  const bw = (W - PADL * 2) / shown.length;
  const y = (v) => PADT + (1 - v / max) * (H - PADT - PADB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart chart-wide" role="img" aria-label="group means">
      {shown.map((g, i) => {
        const cx = PADL + i * bw + bw / 2;
        const barW = Math.min(56, bw * 0.55);
        const sd = g.sd || 0;
        return (
          <g key={g.label}>
            <rect x={cx - barW / 2} y={y(g.mean)} width={barW} height={H - PADB - y(g.mean)} rx="3" className="bar">
              <title>{`${g.label}: mean ${g.mean.toFixed(2)}${sd ? ` ± ${sd.toFixed(2)}` : ''} (n=${g.n})`}</title>
            </rect>
            {sd > 0 && <>
              <line x1={cx} x2={cx} y1={y(g.mean + sd)} y2={y(Math.max(0, g.mean - sd))} className="errbar" />
              <line x1={cx - 6} x2={cx + 6} y1={y(g.mean + sd)} y2={y(g.mean + sd)} className="errbar" />
              <line x1={cx - 6} x2={cx + 6} y1={y(Math.max(0, g.mean - sd))} y2={y(Math.max(0, g.mean - sd))} className="errbar" />
            </>}
            <text x={cx} y={y(g.mean) - (sd > 0 ? y(g.mean) - y(g.mean + sd) + 6 : 5)} textAnchor="middle" className="chart-value">{g.mean >= 100 ? Math.round(g.mean) : g.mean.toFixed(1)}</text>
            <text x={cx} y={H - PADB + 14} textAnchor="middle" className="chart-label">{String(g.label).slice(0, 12)}</text>
            <text x={cx} y={H - PADB + 26} textAnchor="middle" className="chart-sublabel">n={g.n}</text>
          </g>
        );
      })}
      <line x1={PADL} x2={W - PADL} y1={H - PADB} y2={H - PADB} className="axis" />
    </svg>
  );
}

// Chi-square: share of each outcome per category (stacked when 3+ outcomes)
export function RateBars({ table, colCats }) {
  if (!table || !table.length) return null;
  const rows = table
    .map((r) => ({ category: r.category, total: r.cells.reduce((a, c) => a + c.observed, 0), cells: r.cells }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const twoCol = colCats.length === 2;
  return (
    <div className="ratebars">
      {twoCol && <div className="ratebar-legendline muted">share of “{colCats[1]}” per {''}category</div>}
      {rows.map((r) => {
        if (twoCol) {
          const yes = r.cells.find((c) => c.col === colCats[1]);
          const rate = (yes ? yes.observed : 0) / r.total;
          return (
            <div key={r.category} className="barchart-row" title={`${r.category}: ${(rate * 100).toFixed(1)}% ${colCats[1]} (${yes ? yes.observed : 0}/${r.total})`}>
              <span className="barchart-label">{r.category}</span>
              <div className="barchart-track">
                <div className="barchart-fill rate" style={{ width: `${Math.max(1.5, rate * 100)}%` }} />
              </div>
              <span className="barchart-count">{(rate * 100).toFixed(1)}%</span>
            </div>
          );
        }
        return (
          <div key={r.category} className="barchart-row" title={r.category}>
            <span className="barchart-label">{r.category}</span>
            <div className="barchart-track stacked">
              {r.cells.map((c, ci) => (
                <div key={c.col} className={`stack-seg seg${ci % 4}`} style={{ width: `${(c.observed / r.total) * 100}%` }} title={`${c.col}: ${c.observed}`} />
              ))}
            </div>
            <span className="barchart-count">{r.total}</span>
          </div>
        );
      })}
      {!twoCol && (
        <div className="stack-legend">
          {colCats.slice(0, 4).map((c, ci) => <span key={c} className="stack-key"><i className={`seg${ci % 4}`} />{c}</span>)}
        </div>
      )}
    </div>
  );
}

// Scatter plot with least-squares line (correlation results)
export function ScatterPlot({ points, col1, col2 }) {
  if (!points || points.length < 3) return null;
  const W = 460, H = 220, P = { l: 46, r: 12, t: 12, b: 30 };
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const sx = (x) => P.l + ((x - xmin) / (xmax - xmin || 1)) * (W - P.l - P.r);
  const sy = (y) => H - P.b - ((y - ymin) / (ymax - ymin || 1)) * (H - P.t - P.b);
  // least squares fit
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0, icept = my - slope * mx;
  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : +v.toFixed(1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart chart-wide" role="img" aria-label="scatter plot">
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} className="axis" />
      <line x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} className="axis" />
      <line x1={sx(xmin)} y1={sy(icept + slope * xmin)} x2={sx(xmax)} y2={sy(icept + slope * xmax)} className="fitline" />
      {points.map((p, i) => <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="3" className="dot" />)}
      <text x={P.l} y={H - P.b + 14} className="chart-label">{fmt(xmin)}</text>
      <text x={W - P.r} y={H - P.b + 14} textAnchor="end" className="chart-label">{fmt(xmax)}</text>
      <text x={P.l - 6} y={H - P.b} textAnchor="end" className="chart-label">{fmt(ymin)}</text>
      <text x={P.l - 6} y={P.t + 8} textAnchor="end" className="chart-label">{fmt(ymax)}</text>
      <text x={(W + P.l) / 2} y={H - 4} textAnchor="middle" className="chart-sublabel">{col1}</text>
      <text x={12} y={(H - P.b + P.t) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(H - P.b + P.t) / 2})`} className="chart-sublabel">{col2}</text>
    </svg>
  );
}

export function ScoreRing({ score }) {
  const R = 34, C = 2 * Math.PI * R;
  const color = score >= 80 ? 'var(--good)' : score >= 55 ? 'var(--warn)' : 'var(--bad)';
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`quality score ${score}`}>
      <circle cx="44" cy="44" r={R} fill="none" stroke="var(--ring-bg)" strokeWidth="8" />
      <circle
        cx="44" cy="44" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * C} ${C}`} transform="rotate(-90 44 44)"
      />
      <text x="44" y="49" textAnchor="middle" className="score-text" fill={color}>{score}</text>
    </svg>
  );
}
