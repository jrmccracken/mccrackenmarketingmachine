import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api.js';
import Overview from './pages/Overview.jsx';
import { EmailPage, SocialPage, WebsitePage, SearchPage, PaidPage } from './pages/Channels.jsx';
import Recommendations from './pages/Recommendations.jsx';
import Radar from './pages/Radar.jsx';
import Leads from './pages/Leads.jsx';
import LeadDetail from './pages/LeadDetail.jsx';
import Outreach from './pages/Outreach.jsx';
import Integrations from './pages/Integrations.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['Workspace', [['/', 'Command centre'], ['/recommendations', 'Recommendations', 'recommendations']]],
  ['Performance', [['/email', 'Outbound email'], ['/social', 'Social'], ['/website', 'Website (GA4)'], ['/search', 'Search Console'], ['/paid', 'Paid: Google & ChatGPT']]],
  ['Growth', [['/radar', 'Market radar', 'opportunities'], ['/leads', 'Leads', 'due'], ['/outreach', 'Outreach', 'drafts']]],
  ['Setup', [['/integrations', 'Integrations'], ['/settings', 'Settings']]],
];

export default function App() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    const load = () => api.get('/status').then(setStatus).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [loc.pathname]);
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="app">
      <div className="mobile-bar">
        <button className="btn sm" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
        <strong>Marketing Machine</strong>
        <span />
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">M</div>
          <div><strong>Marketing Machine</strong><small>{status?.company || 'McCracken Marketing'}</small></div>
        </div>
        <nav className="nav">
          {NAV.map(([group, items]) => (
            <div key={group}>
              <div className="nav-group">{group}</div>
              {items.map(([to, label, countKey]) => (
                <NavLink key={to} to={to} end={to === '/'}>
                  <span>{label}</span>
                  {countKey && status?.counts?.[countKey] > 0 && <span className="count">{status.counts[countKey]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>AI strategist: {status?.ai ? 'on' : 'off (add key in Settings)'}</span>
          <span>Email sending: {status?.smtp ? 'SMTP connected' : 'not connected'}</span>
          {status?.demo && <span>Showing demo data for unconnected channels</span>}
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview status={status} />} />
          <Route path="/recommendations" element={<Recommendations status={status} />} />
          <Route path="/email" element={<EmailPage />} />
          <Route path="/social" element={<SocialPage />} />
          <Route path="/website" element={<WebsitePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/paid" element={<PaidPage />} />
          <Route path="/radar" element={<Radar />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:id" element={<LeadDetail />} />
          <Route path="/outreach" element={<Outreach />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="empty">Page not found</div>} />
        </Routes>
      </main>
    </div>
  );
}
