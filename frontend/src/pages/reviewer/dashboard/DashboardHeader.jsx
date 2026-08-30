import React from 'react';
import Icon from '../../../components/ui/Icon';

/* ============================================================================
   DashboardHeader — 64px flat bar replacing the gradient hero.
   Breadcrumb, H1 and reviewer identity on one line. Flat surface with a bottom
   border; no gradient, no elevation.
   ============================================================================ */

export default function DashboardHeader({ officer = 'Reviewer', designation = 'Drug Controller Officer' }) {
  return (
    <header className="dh">
      <div className="dh-inner">
        <div className="dh-text">
          <nav className="dh-crumb" aria-label="Breadcrumb">
            <ol>
              <li><a href="/review">Dashboard</a></li>
              <li aria-current="page">Export NOC Review</li>
            </ol>
          </nav>
          <h1 className="dh-title">Export NOC Review</h1>
        </div>

        <div className="dh-identity">
          <Icon name="fileText" size={18} />
          <span className="dh-identity-text">
            <span className="dh-officer">{officer}</span>
            <span className="dh-designation">{designation}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
