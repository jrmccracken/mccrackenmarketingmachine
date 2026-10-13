import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { KPI, fmt } from '../lib/format.js';
import { Sparkline } from './Chart.jsx';

export function useFetch(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true }));
    api.get(url).then((data) => setState({ data, error: null, loading: false }), (error) => setState({ data: null, error, loading: false }));
  }, [url]);
  useEffect(load, [load, ...deps]);
  return { ...state, reload: load };
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const show = useCallback((m) => { setMsg(m); setTimeout(() => setMsg(null), 4000); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Wraps an async action with busy state + error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = async (key, fn, success) => {
    setBusy(key);
    try { const r = await fn(); if (success) toast(typeof success === 'function' ? success(r) : success); return r; }
    catch (err) { toast(err.message); }
    finally { setBusy(null); }
  };
  return [busy, run];
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div>{title && <h2>{title}</h2>}{sub && <p>{sub}</p>}</div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Delta({ value, up = true }) {
  if (value == null || !isFinite(value) || Math.abs(value) < 0.005) return <span className="stat-delta muted">no change</span>;
  const good = up == null ? null : (value > 0) === up;
  return (
    <span className={`stat-delta ${good == null ? 'secondary' : good ? 'good' : 'bad'}`}>
      {value > 0 ? '▲' : '▼'} {fmt.pct(Math.abs(value), 0)} <span className="muted">vs prev.</span>
    </span>
  );
}

export function Stat({ k, value, change, label, spark, sub }) {
  const def = KPI[k] || { label: k, f: fmt.n, up: true };
  return (
    <div className="stat">
      <span className="stat-label">{label || def.label}</span>
      <span className="stat-value num">{def.f(value)}</span>
      {change !== undefined && <Delta value={change} up={def.up} />}
      {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
      {spark && <Sparkline values={spark} />}
    </div>
  );
}

export function StatRow({ snap, keys }) {
  if (!snap) return null;
  return (
    <div className="grid cols-4">
      {keys.map((k) => <div className="card" key={k}><Stat k={k} value={snap.current[k]} change={snap.change[k]} /></div>)}
    </div>
  );
}

export function Priority({ p }) {
  return <span className={`badge ${p}`}><span className="dot" />{p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'Low'}</span>;
}

export function DemoBadge({ show }) {
  return show ? <span className="badge demo" title="Illustrative data: connect the integration to see real numbers">Demo data</span> : null;
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="row between"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export const RANGES = [[7, '7d'], [28, '28d'], [90, '90d']];
export function useRange() {
  const [days, setDays] = useState(() => Number(localStorageGet('mmm.days')) || 28);
  const set = (d) => { setDays(d); try { localStorage.setItem('mmm.days', d); } catch {} };
  return [days, set];
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }

/** Sortable table. cols: [{ key, label, f?, r? (right align), render? }] */
export function DataTable({ rows, cols, initialSort, limit = 100, onRow, empty = 'No data' }) {
  const [sort, setSort] = useState(initialSort || null);
  const [showAll, setShowAll] = useState(false);
  let list = [...(rows || [])];
  if (sort) list.sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    const c = typeof av === 'number' || typeof bv === 'number' ? (av || 0) - (bv || 0) : String(av || '').localeCompare(String(bv || ''));
    return sort.dir === 'asc' ? c : -c;
  });
  const shown = showAll ? list : list.slice(0, limit);
  if (!list.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => (
            <th key={c.key} className={`sortable ${c.r ? 'r' : ''}`} onClick={() => setSort({ key: c.key, dir: sort?.key === c.key && sort.dir === 'desc' ? 'asc' : 'desc' })}>
              {c.label}{sort?.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.id ?? r.name ?? i} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>
              {cols.map((c) => <td key={c.key} className={`${c.r ? 'r num' : ''}`}>{c.render ? c.render(r) : c.f ? c.f(r[c.key]) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > limit && <div style={{ padding: 8 }}><button className="btn sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${list.length}`}</button></div>}
    </div>
  );
}

/** Tiny markdown renderer for AI briefs: headings, bullets, bold, paragraphs. */
export function Markdown({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const blocks = [];
  let list = null;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (/^[-*] /.test(t)) { (list ||= []).push(t.slice(2)); continue; }
    if (list) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = null; }
    if (!t) continue;
    const h = t.match(/^(#{1,3}) (.*)/);
    blocks.push(h ? <h3 key={blocks.length}>{inline(h[2])}</h3> : <p key={blocks.length}>{inline(t)}</p>);
  }
  if (list) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
  return <div className="md">{blocks}</div>;
}

export function Loading() { return <div className="empty">Loading…</div>; }
export function ErrorBox({ error }) { return error ? <div className="notice">Couldn't load: {error.message}</div> : null; }
