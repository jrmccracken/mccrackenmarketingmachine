import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BarChart3, Building2, Globe, Lightbulb, Mail, Menu, Plug, Radar as RadarIcon, Search, Send, Settings as SettingsIcon, Share2, Users, LayoutDashboard } from 'lucide-react';
import { api } from './lib/api.js';
import Overview from './pages/Overview.jsx';
import { EmailPage, SocialPage, WebsitePage, SearchPage, PaidPage } from './pages/Channels.jsx';
import Recommendations from './pages/Recommendations.jsx';
import Radar from './pages/Radar.jsx';
import Visitors from './pages/Visitors.jsx';
import Leads from './pages/Leads.jsx';
import LeadDetail from './pages/LeadDetail.jsx';
import Outreach from './pages/Outreach.jsx';
import Integrations from './pages/Integrations.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['Workspace', [['/', 'Overview', null, LayoutDashboard], ['/recommendations', 'Recommendations', 'recommendations', Lightbulb]]],
  ['Performance', [['/email', 'Outbound email', null, Mail], ['/social', 'Social', null, Share2], ['/website', 'Website', null, Globe], ['/search', 'Search Console', null, Search], ['/paid', 'Paid ads', null, BarChart3]]],
  ['Growth', [['/visitors', 'Company visitors', null, Building2], ['/radar', 'Market radar', 'opportunities', RadarIcon], ['/leads', 'Leads', 'due', Users], ['/outreach', 'Outreach', 'drafts', Send]]],
  ['Setup', [['/integrations', 'Integrations', null, Plug], ['/settings', 'Settings', null, SettingsIcon]]],
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
        <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-label="Menu"><Menu /></button>
        <strong>Marketing Machine</strong>
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="logo" aria-hidden="true">M</div>
          <div><strong>Marketing Machine</strong><small>McCracken Marketing</small></div>
        </div>
        <nav className="nav">
          {NAV.map(([group, items]) => (
            <div key={group}>
              <div className="nav-group">{group}</div>
              {items.map(([to, label, countKey, Icon]) => (
                <NavLink key={to} to={to} end={to === '/'}>
                  <Icon aria-hidden="true" />
                  <span className="label">{label}</span>
                  {countKey && status?.counts?.[countKey] > 0 && <span className="count">{status.counts[countKey]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="s"><i className={status?.ai ? 'on' : ''} />AI strategist {status?.ai ? 'on' : 'off'}</span>
          <span className="s"><i className={status?.smtp ? 'on' : ''} />Email sending {status?.smtp ? 'connected' : 'not connected'}</span>
          {status?.demo && <span className="s"><i />Some channels show demo data</span>}
          {status?.version && <span>Version {status.version}</span>}
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
          <Route path="/visitors" element={<Visitors />} />
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
