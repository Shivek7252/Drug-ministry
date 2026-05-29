import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { MOCK_APPLICATIONS, CHART_DATA } from '../data/mockData';
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
          <StatCard icon="📋" label="Total Applications" value="972" color="#003580" sub="↑ 12% this month" />
          <StatCard icon="✅" label="Approved" value="784" color="#2E7D32" sub="80.7% approval rate" />
          <StatCard icon="⏳" label="Pending" value="143" color="#FF6F00" sub="Avg. 5 days processing" />
          <StatCard icon="❌" label="Rejected" value="45" color="#C62828" sub="4.6% rejection rate" />
        </div>

        {/* Charts Row 1 */}
        <div className="charts-row">
          <div className="chart-card chart-wide">
            <div className="chart-card-header">
              <h3>📊 Monthly Applications vs Approvals (2026)</h3>
            </div>
            <div className="chart-card-body">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={CHART_DATA.monthly} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
                    data={CHART_DATA.drugCategory}
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
                <BarChart data={CHART_DATA.countryExports} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
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
                  {MOCK_APPLICATIONS.map(app => (
                    <tr key={app.id}>
                      <td><strong style={{ color: '#003580' }}>{app.id}</strong></td>
                      <td><code>{app.refNo}</code></td>
                      <td>{app.applicant}</td>
                      <td>{app.country}</td>
                      <td>{app.category}</td>
                      <td><span className="badge badge-primary">{app.products}</span></td>
                      <td>{app.date}</td>
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
