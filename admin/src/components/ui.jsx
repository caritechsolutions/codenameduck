import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Drawer({ title, subtitle, onClose, children, width }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" style={width ? { width } : undefined} role="dialog" aria-label={title}>
        <div className="head">
          <div><h2>{title}</h2>{subtitle && <div className="muted small">{subtitle}</div>}</div>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = 'Delete', onConfirm, onClose, danger = true }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button onClick={onClose}>Cancel</button>
      <button className={danger ? 'danger' : 'primary'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</button>
    </>}>
      <p>{text}</p>
    </Modal>
  );
}

export function Field({ label, children, hint }) {
  return <div className="field"><label>{label}</label>{children}{hint && <div className="muted small" style={{ marginTop: 4 }}>{hint}</div>}</div>;
}

export function Status({ online, ws }) {
  return <span title={ws ? 'connected over WebSocket' : online ? 'seen in the last 3 minutes' : 'offline'}>
    <span className={'dot ' + (online ? 'on' : 'off')} />{online ? (ws ? 'online · live' : 'online') : 'offline'}
  </span>;
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn().then((data) => setState({ loading: false, data, error: null }), (error) => setState({ loading: false, data: null, error }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}
