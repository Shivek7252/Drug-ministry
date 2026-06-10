import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import './WizardStep.css';

const CHECKLIST = [
  { key: 'productInfoAccurate', label: 'I confirm that all product information provided in this application is accurate, complete, and up-to-date.' },
  { key: 'documentsGenuine', label: 'I confirm that all uploaded documents are genuine, valid, and have not been tampered with or falsified.' },
  { key: 'exportRegulations', label: 'I confirm that the export of these drug products complies with all applicable export regulations, including the Drugs and Cosmetics Act, 1940 and Rules 1945.' },
  { key: 'drugComplies', label: 'I confirm that the drug products comply with the quality standards and guidelines prescribed by the Ministry of Health & Family Welfare, Government of India.' }
];

export default function Step6Declaration() {
  const { formData, updateDeclaration, setCurrentStep } = useApp();
  const { declarations } = formData;
  const [errors, setErrors] = useState({});

  const handleCheck = (key) => {
    updateDeclaration(key, !declarations[key]);
    if (errors[key]) setErrors(p => ({ ...p, [key]: '' }));
  };

  const handleNext = () => {
    const e = {};
    CHECKLIST.forEach(item => {
      if (!declarations[item.key]) e[item.key] = 'This confirmation is required';
    });
    if (!declarations.finalDeclaration) e.finalDeclaration = 'You must accept the final declaration to proceed';
    setErrors(e);
    if (Object.keys(e).length === 0) setCurrentStep(7);
  };

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">⚖️</div>
        <div>
          <h2>Declaration and Compliance</h2>
          <p>Please read and confirm all declarations before submitting your application</p>
        </div>
      </div>

      {/* Legal Declaration */}
      <div className="card mb-3">
        <div className="card-header">
          <span>📜</span>
          <h3>Legal Declaration</h3>
        </div>
        <div className="card-body">
          <div className="declaration-text">
            <p>
              I/We, the undersigned, being the authorized representative of the applicant organization, hereby apply for
              the grant of <strong>Export No Objection Certificate (NOC)</strong> for the drug products listed in this application,
              under the provisions of the <strong>Drugs and Cosmetics Act, 1940</strong> and the rules made thereunder.
            </p>
            <p style={{ marginTop: 12 }}>
              I/We hereby declare and undertake that:
            </p>
            <ol style={{ marginTop: 8, paddingLeft: 20, lineHeight: 2 }}>
              <li>The information furnished in this application is true, correct, and complete to the best of my/our knowledge and belief.</li>
              <li>The drug products for which NOC is sought are manufactured in compliance with the Good Manufacturing Practices (GMP) as prescribed under Schedule M of the Drugs and Cosmetics Rules, 1945.</li>
              <li>The export of these drug products is in compliance with the laws of the destination country and all applicable international regulations.</li>
              <li>I/We understand that any false statement or misrepresentation of facts may result in rejection of this application and/or legal action under applicable laws.</li>
              <li>I/We undertake to comply with any conditions that may be imposed by the Central Drugs Standard Control Organisation (CDSCO) while granting the Export NOC.</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Compliance Checklist */}
      <div className="card mb-3">
        <div className="card-header">
          <span>✅</span>
          <h3>Compliance Checklist</h3>
        </div>
        <div className="card-body">
          <p style={{ fontSize: 13, color: '#546E7A', marginBottom: 16 }}>
            Please confirm each of the following statements by checking the corresponding box:
          </p>
          {CHECKLIST.map((item, i) => (
            <div key={item.key} className={`compliance-item ${errors[item.key] ? 'has-error' : ''}`}>
              <div className="checkbox-group">
                <input
                  type="checkbox"
                  id={item.key}
                  checked={declarations[item.key]}
                  onChange={() => handleCheck(item.key)}
                />
                <label htmlFor={item.key}>
                  <span className="compliance-num">{i + 1}.</span> {item.label}
                </label>
              </div>
              {errors[item.key] && <div className="form-error" style={{ marginLeft: 26 }}>⚠ {errors[item.key]}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Final Declaration */}
      <div className={`card mb-3 final-declaration-card ${errors.finalDeclaration ? 'error-card' : ''}`}>
        <div className="card-body">
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="finalDeclaration"
              checked={declarations.finalDeclaration}
              onChange={() => { updateDeclaration('finalDeclaration', !declarations.finalDeclaration); if (errors.finalDeclaration) setErrors(p => ({ ...p, finalDeclaration: '' })); }}
            />
            <label htmlFor="finalDeclaration" style={{ fontWeight: 600, fontSize: 14, color: '#1A237E' }}>
              I hereby declare that all information provided in this application is true and correct to the best of my knowledge.
              I understand that providing false information is a punishable offence under the Drugs and Cosmetics Act, 1940.
            </label>
          </div>
          {errors.finalDeclaration && <div className="form-error" style={{ marginLeft: 26, marginTop: 6 }}>⚠ {errors.finalDeclaration}</div>}
        </div>
      </div>

      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(5)}>← Previous</button>
        <button className="btn btn-primary btn-lg" onClick={handleNext}>
          Next: Review Application →
        </button>
      </div>
    </div>
  );
}
