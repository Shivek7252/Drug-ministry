import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import AuthGuard from './components/auth/AuthGuard';
import DashboardPage from './pages/DashboardPage';
import ApplyPage from './pages/ApplyPage';
import TrackPage from './pages/TrackPage';
import HelpPage from './pages/HelpPage';
import ContactPage from './pages/ContactPage';
import './App.css';

function App() {
  return (
    <AppProvider>
      <Router>
        <div className="app-wrapper">
          <Navbar />
          <main className="app-main">
            <Routes>
              <Route path="/"        element={<AuthGuard><DashboardPage /></AuthGuard>} />
              <Route path="/apply"   element={<AuthGuard><ApplyPage /></AuthGuard>} />
              <Route path="/track"   element={<AuthGuard><TrackPage /></AuthGuard>} />
              <Route path="/help"    element={<AuthGuard><HelpPage /></AuthGuard>} />
              <Route path="/contact" element={<AuthGuard><ContactPage /></AuthGuard>} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </AppProvider>
  );
}

export default App;
