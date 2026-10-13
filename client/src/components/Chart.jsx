import { useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../lib/format.js';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Line chart with a crosshair tooltip. One y-axis only: series passed together must share a unit.
 * series: [{ key, label }], data: [{ date, [key]: number }]
 */
export function LineChart({ data, series, height = 220, format = fmt.n, area = series.length === 1 }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const H = height, pad = { l: 44, r: 12, t: 10, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = useMemo(() => niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)))), [data, series]);
  const x = (i) => pad.l + (data.length < 2 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(W / 90))));
  const tick = (t) => (format === fmt.money ? '£' : '') + (max < 5 ? String(Math.round(t * 10) / 10) : fmt.n(t));

  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
    setHover(i >= 0 && i < data.length ? i : null);
  };

  return (
    <div className="chart" ref={wrap}>
      {!data.length && <div className="empty">No data for this period</div>}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s, i) => <span key={s.key}><span className="key" style={{ background: SERIES[i] }} />{s.label}</span>)}
        </div>
      )}
      {data.length > 0 && <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`${series.map((s) => s.label).join(', ')} over time`}>
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{tick(t)}</text>
            </g>
          ))}
          {data.map((d, i) => (i % step === 0 ? <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle">{fmt.date(d.date)}</text> : null))}
        </g>
        {series.map((s, si) => {
          const pts = data.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`);
          return (
            <g key={s.key}>
              {area && <path d={`M${x(0)},${y(0)} L${pts.join(' L')} L${x(data.length - 1)},${y(0)} Z`} fill={SERIES[si]} opacity="0.1" />}
              <polyline points={pts.join(' ')} fill="none" stroke={SERIES[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-muted)" strokeWidth="1" />
            {series.map((s, si) => <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key] || 0)} r="4.5" fill={SERIES[si]} stroke="var(--surface-1)" strokeWidth="2" />)}
          </g>
        )}
      </svg>}
      {hover != null && (
        <div className="tooltip" style={{ left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 160px))`, top: 8 }}>
          <div className="muted" style={{ marginBottom: 4 }}>{new Date(data[hover].date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          {series.map((s, si) => (
            <div className="t-row" key={s.key}><span><span className="key" style={{ background: SERIES[si] }} />{s.label}</span><strong className="num">{format(data[hover][s.key] || 0)}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values = [], width = 120, height = 32 }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 3 - ((v - min) / (max - min || 1)) * (height - 6)}`);
  const last = pts.at(-1).split(',');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity="0.7" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="var(--series-1)" />
    </svg>
  );
}

/** Horizontal bars: one series, value labelled at the tip, hover shows the full row. */
export function BarList({ rows, value, format = fmt.n, label = (r) => r.name, extra }) {
  const max = Math.max(...rows.map(value), 1);
  if (!rows.length) return <div className="empty">No data</div>;
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-row" key={label(r)} title={`${label(r)}: ${format(value(r))}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(r)}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(value(r) / max) * 100}%` }} /></div>
          <span className="num secondary" style={{ minWidth: 60, textAlign: 'right' }}>{format(value(r))}{extra ? <span className="muted"> {extra(r)}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
