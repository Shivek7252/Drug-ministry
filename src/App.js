import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { useApp } from './context/AppContext';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import AuthGuard from './components/auth/AuthGuard';
import DashboardPage from './pages/DashboardPage';
import ApplyPage from './pages/ApplyPage';
import TrackPage from './pages/TrackPage';
import HelpPage from './pages/HelpPage';
import ContactPage from './pages/ContactPage';
import ReviewDashboard from './pages/reviewer/ReviewDashboard';
import './App.css';

/* Route guard that redirects reviewer to /review */
function RoleRoute({ children }) {
  const { isLoggedIn, userRole } = useApp();
  if (!isLoggedIn) return <AuthGuard>{children}</AuthGuard>;
  if (userRole === 'reviewer') return <Navigate to="/review" replace />;
  return children;
}

function AppRoutes() {
  const { isLoggedIn, userRole } = useApp();

  return (
    <Routes>
      {/* Reviewer routes */}
      <Route path="/review/*" element={
        isLoggedIn && userRole === 'reviewer'
          ? <ReviewDashboard />
          : <AuthGuard><DashboardPage /></AuthGuard>
      }/>

      {/* Applicant routes */}
      <Route path="/"        element={<RoleRoute><AuthGuard><DashboardPage /></AuthGuard></RoleRoute>} />
      <Route path="/apply"   element={<RoleRoute><AuthGuard><ApplyPage /></AuthGuard></RoleRoute>} />
      <Route path="/track"   element={<RoleRoute><AuthGuard><TrackPage /></AuthGuard></RoleRoute>} />
      <Route path="/help"    element={<AuthGuard><HelpPage /></AuthGuard>} />
      <Route path="/contact" element={<AuthGuard><ContactPage /></AuthGuard>} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AppProvider>
      <Router>
        <div className="app-wrapper">
          <Navbar />
          <main className="app-main">
            <AppRoutes />
          </main>
          <Footer />
        </div>
      </Router>
    </AppProvider>
  );
}

export default App;
