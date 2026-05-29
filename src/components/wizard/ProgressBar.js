import React from 'react';
import './ProgressBar.css';

const STEPS = [
  { num: 1, label: 'Application\nDetails' },
  { num: 2, label: 'Consignee\nDetails' },
  { num: 3, label: 'Drug/Product\nInfo' },
  { num: 4, label: 'Manufacturer\nDetails' },
  { num: 5, label: 'Document\nUpload' },
  { num: 6, label: 'Declaration &\nCompliance' },
  { num: 7, label: 'Review\nApplication' },
  { num: 8, label: 'Submitted' }
];

export default function ProgressBar({ currentStep }) {
  const pct = Math.round(((currentStep - 1) / (STEPS.length - 1)) * 100);

  return (
    <div className="progress-wrap">
      <div className="progress-header">
        <div className="progress-title">
          <span className="progress-icon">📋</span>
          <div>
            <h2>Apply for Export NOC</h2>
            <p>Step {currentStep} of {STEPS.length} — {STEPS[currentStep - 1].label.replace('\n', ' ')}</p>
          </div>
        </div>
        <div className="progress-pct">
          <div className="pct-circle">
            <svg viewBox="0 0 36 36">
              <path className="pct-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path className="pct-fill" strokeDasharray={`${pct}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span>{pct}%</span>
          </div>
          <span className="pct-label">Complete</span>
        </div>
      </div>

      <div className="steps-container">
        <div className="steps-track">
          <div className="steps-line">
            <div className="steps-line-fill" style={{ width: `${pct}%` }} />
          </div>
          {STEPS.map((step) => {
            const done = currentStep > step.num;
            const active = currentStep === step.num;
            return (
              <div key={step.num} className={`step-item ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                <div className="step-circle">
                  {done ? <span className="step-check">✓</span> : <span>{step.num}</span>}
                </div>
                <div className="step-label">{step.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
