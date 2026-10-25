import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { get, post } from './api.ts';
import { Loading } from './components/ui.tsx';
import Login from './pages/Login.tsx';
import Confirm from './pages/Confirm.tsx';
import AdminHome from './pages/AdminHome.tsx';
import Workspace from './pages/Workspace.tsx';

export interface Me { user: { id: string; name: string; email: string; role: 'admin' | 'client' } | null; workspaces: { id: string; name: string; status: string }[]; unread: number }

const MeContext = createContext<{ me: Me | null; reload: () => Promise<void> }>({ me: null, reload: async () => {} });
export const useMe = () => useContext(MeContext);

export function Logo() {
  return <span className="logo" aria-hidden="true"><span>McCracken</span><span>Marketing</span></span>;
}

function Header() {
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try { await post('/auth/logout'); } finally { window.location.assign('/login?signed_out=1'); }
  };
  return (
    <header className="site-header">
      <div className="wrap">
        <Link to="/" className="brand">
          <Logo />
          <span className="brand-text">Marketing Control Centre<small>McCracken Marketing client workspace</small></span>
        </Link>
        {me?.user && (
          <div className="header-user">
            {me.user.role === 'admin' && <Link to="/admin">All workspaces{me.unread ? ` (${me.unread} new)` : ''}</Link>}
            <span>{me.user.name || me.user.email}</span>
            <button type="button" className="btn small" onClick={signOut} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button>
          </div>
        )}
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        Private client area · <a href="https://mccrackenmarketing.co.uk/">mccrackenmarketing.co.uk</a> · <a href="https://mccrackenmarketing.co.uk/privacy-policy/">Privacy policy</a> · Questions? <a href="mailto:james@mccrackenmarketing.co.uk">james@mccrackenmarketing.co.uk</a>
      </div>
    </footer>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      {children}
      <Footer />
    </>
  );
}

function RequireUser({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const loc = useLocation();
  if (!me) return <main className="wrap"><Loading /></main>;
  if (!me.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function Home() {
  const { me } = useMe();
  if (me?.user?.role === 'admin') return <Navigate to="/admin" replace />;
  const list = me?.workspaces || [];
  if (list.length === 1) return <Navigate to={`/workspaces/${list[0].id}`} replace />;
  return (
    <main id="main" className="wrap">
      <h1>Your workspaces</h1>
      {list.length ? (
        <ul className="list">{list.map((w) => <li key={w.id}><Link to={`/workspaces/${w.id}`}>{w.name}</Link></li>)}</ul>
      ) : <p className="empty">You don't have access to an active workspace at the moment. Please contact James McCracken.</p>}
    </main>
  );
}

function NotFound() {
  return <main id="main" className="wrap"><h1>Page not found</h1><p>This page doesn't exist, or you don't have access to it.</p><p><Link to="/">Go to your workspace</Link></p></main>;
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(async () => {
    try { setMe(await get<Me>('/me')); } catch { setMe({ user: null, workspaces: [], unread: 0 }); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <MeContext.Provider value={{ me, reload }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/confirm" element={<Confirm />} />
        <Route path="/" element={<Shell><RequireUser><Home /></RequireUser></Shell>} />
        <Route path="/admin" element={<Shell><RequireUser><AdminHome /></RequireUser></Shell>} />
        <Route path="/workspaces/:id" element={<Shell><RequireUser><Workspace /></RequireUser></Shell>} />
        <Route path="*" element={<Shell><NotFound /></Shell>} />
      </Routes>
    </MeContext.Provider>
  );
}
