import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { MOCK_APPLICATIONS, CHART_DATA } from '../data/mockData';
import { listApplications, getDashboardStats } from '../api/applicationService';
import './DashboardPage.css';

const PIE_COLORS = ['#003580','#1565C0','#0277BD','#2E7D32','#FF6F00','#C62828','#7B1FA2'];

function StatCard({ icon, label, value, color, sub }) {
  return (
    <div className="stat-card" style={{ borderTopColor: color }}>
      <div className="stat-card-icon" style={{ background: color + '18', color }}>{icon}</div>
      <div className="stat-card-body">
        <div className="stat-value" style={{ color }}>{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    'Approved': 'badge-success',
    'Under Review': 'badge-info',
    'Pending': 'badge-warning',
    'Rejected': 'badge-danger'
  };
  return <span className={`badge ${map[status] || 'badge-primary'}`}>{status}</span>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats,    setStats]    = useState(null);
  const [apps,     setApps]     = useState([]);
  const [dbOnline, setDbOnline] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [monthly,  setMonthly]  = useState(CHART_DATA.monthly);
  const [byCountry,setByCountry]= useState(CHART_DATA.countryExports);
  const [byCat,    setByCat]    = useState(CHART_DATA.drugCategory);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [statsRes, appsRes] = await Promise.all([
        getDashboardStats(),
        listApplications({ limit: 10 }),
      ]);

      if (statsRes.success) {
        setStats(statsRes.stats);
        if (statsRes.monthly?.some(m => m.applications > 0)) setMonthly(statsRes.monthly);
        if (statsRes.byCountry?.length  > 0) setByCountry(statsRes.byCountry);
        if (statsRes.byCategory?.length > 0) setByCat(statsRes.byCategory);
        setDbOnline(true);
      } else {
        // Backend offline — keep dbOnline false so we show demo label
        setDbOnline(false);
      }
      if (appsRes.success) {
        setApps(appsRes.applications || []);
      }
      setLoading(false);
    })();
  }, []);

  // Use live stats when DB online, demo numbers only when backend is offline
  const statValues = dbOnline
    ? (stats || { total: 0, approved: 0, pending: 0, rejected: 0, underReview: 0 })
    : { total: 972, approved: 784, pending: 143, rejected: 45, underReview: 0 };

  const approvalRate = statValues.total > 0
    ? Math.round((statValues.approved / statValues.total) * 100)
    : 0;
  const rejectionRate = statValues.total > 0
    ? Math.round((statValues.rejected / statValues.total) * 100)
    : 0;

  return (
    <div className="dashboard-page">
      <div className="dashboard-container">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <h1>Export NOC Dashboard</h1>
            <p>Central Drugs Standard Control Organisation — Ministry of Health &amp; Family Welfare</p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/apply')}>
            ➕ New Application
          </button>
        </div>

        {/* Stat Cards */}
        <div className="stats-grid">
          <StatCard icon="📋" label="Total Applications" value={loading ? '…' : statValues.total}    color="#003580" sub={loading ? 'Loading…' : dbOnline ? '✓ Live data' : '⚠ Demo data'} />
          <StatCard icon="✅" label="Approved"           value={loading ? '…' : statValues.approved} color="#2E7D32" sub={loading ? '' : `${approvalRate}% approval rate`} />
          <StatCard icon="⏳" label="Pending / Submitted" value={loading ? '…' : (statValues.pending || (statValues.total - statValues.approved - statValues.rejected))} color="#FF6F00" sub={loading ? '' : 'Awaiting review'} />
          <StatCard icon="❌" label="Rejected"           value={loading ? '…' : statValues.rejected} color="#C62828" sub={loading ? '' : `${rejectionRate}% rejection rate`} />
        </div>

        {/* Charts Row 1 */}
        <div className="charts-row">
          <div className="chart-card chart-wide">
            <div className="chart-card-header">
              <h3>📊 Monthly Applications vs Approvals (2026)</h3>
            </div>
            <div className="chart-card-body">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthly} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="applications" name="Applications" fill="#003580" radius={[3,3,0,0]} />
                  <Bar dataKey="approved" name="Approved" fill="#2E7D32" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <h3>🌍 Drug Category Distribution</h3>
            </div>
            <div className="chart-card-body">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={byCat}
                    cx="50%" cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {CHART_DATA.drugCategory.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="charts-row">
          <div className="chart-card">
            <div className="chart-card-header">
              <h3>📈 Approval Rate Trend (%)</h3>
            </div>
            <div className="chart-card-body">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={CHART_DATA.approvalTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis domain={[75, 90]} tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v) => [`${v}%`, 'Approval Rate']} />
                  <Line type="monotone" dataKey="rate" stroke="#003580" strokeWidth={2.5} dot={{ r: 4, fill: '#003580' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card chart-wide">
            <div className="chart-card-header">
              <h3>🌐 Country-wise Exports (Top 8)</h3>
            </div>
            <div className="chart-card-body">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byCountry} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="country" type="category" tick={{ fontSize: 12 }} width={60} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  <Bar dataKey="value" name="Exports" fill="#1565C0" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Recent Applications */}
        <div className="card">
          <div className="card-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📋</span>
              <h3>Recent Applications</h3>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/track')}>View All →</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {apps.length === 0 ? (
              <div style={{padding:'32px',textAlign:'center',color:'#94a3b8'}}>
                <div style={{fontSize:36,marginBottom:8}}>📋</div>
                <p style={{fontWeight:600,color:'#475569',marginBottom:4}}>No applications yet</p>
                <p style={{fontSize:12,marginBottom:16}}>Submitted applications will appear here.</p>
                <button className="btn btn-primary btn-sm" onClick={() => navigate('/apply')}>
                  ➕ Submit First Application
                </button>
              </div>
            ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Application No.</th>
                    <th>Reference No.</th>
                    <th>Applicant</th>
                    <th>Country</th>
                    <th>Category</th>
                    <th>Products</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app, i) => (
                    <tr key={app.applicationNumber || i}>
                      <td><strong style={{ color: '#003580' }}>{app.applicationNumber}</strong></td>
                      <td><code>{app.referenceNumber}</code></td>
                      <td>{app.applicantOrganization || app.applicantName || '—'}</td>
                      <td>{app.destinationCountry || '—'}</td>
                      <td>{app.exportCategory || '—'}</td>
                      <td><span className="badge badge-primary">{app.products?.length || 0}</span></td>
                      <td>{app.applicationDate || (app.createdAt ? new Date(app.createdAt).toLocaleDateString('en-IN') : '—')}</td>
                      <td><StatusBadge status={app.status} /></td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => navigate('/track')}>
                          🔍 Track
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions-grid">
          <div className="quick-action-card" onClick={() => navigate('/apply')}>
            <div className="qa-icon">📋</div>
            <div className="qa-label">New Application</div>
            <div className="qa-desc">Apply for Export NOC</div>
          </div>
          <div className="quick-action-card" onClick={() => navigate('/track')}>
            <div className="qa-icon">🔍</div>
            <div className="qa-label">Track Application</div>
            <div className="qa-desc">Check application status</div>
          </div>
          <div className="quick-action-card">
            <div className="qa-icon">⬇️</div>
            <div className="qa-label">Download NOC</div>
            <div className="qa-desc">Download approved certificates</div>
          </div>
          <div className="quick-action-card">
            <div className="qa-icon">📞</div>
            <div className="qa-label">Helpdesk</div>
            <div className="qa-desc">1800-11-4477 (Toll Free)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
