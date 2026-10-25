import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { label } from '../format.ts';

export function Status({ value, text }: { value: string; text?: string }) {
  return <span className={`status s-${value}`}>{text || label(value)}</span>;
}

export function Priority({ value }: { value: string }) {
  return <span className={`priority p-${value}`}>{label(value)}<span className="sr-only"> priority</span></span>;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <p className="loading" role="status" aria-live="polite">{text}</p>;
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert error" role="alert">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Accessible modal dialog. The native modal <dialog> makes the rest of the page inert, keeping focus inside. */
export function Dialog({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      const opener = document.activeElement as HTMLElement | null;
      d.showModal();
      const first = d.querySelector<HTMLElement>('[data-autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button');
      first?.focus();
      return () => { opener?.focus?.(); };
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && <>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn small" onClick={onClose}>Close</button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </>}
    </dialog>
  );
}

export function Field({ label: text, hint, error, children, id }: { label: string; hint?: string; error?: string; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id || auto;
  const describedBy = [hint && `${fid}-hint`, error && `${fid}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={fid}>{text}</label>
      {hint && <span className="hint" id={`${fid}-hint`}>{hint}</span>}
      {children({ id: fid, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && <span className="error-text" id={`${fid}-error`}>{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- toast

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const timer = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(''), 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="sr-only-container">{msg && <div className="toast">{msg}</div>}</div>
    </ToastContext.Provider>
  );
}

/** Runs an async action, tracking busy state and reporting success or failure. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(key);
    try {
      const r = await fn();
      if (success) toast(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);
  return { busy, run };
}
