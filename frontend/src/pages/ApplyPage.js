import React from 'react';
import { useApp } from '../context/AppContext';
import ProgressBar from '../components/wizard/ProgressBar';
import Step1ApplicationDetails from '../components/wizard/Step1ApplicationDetails';
import Step2ConsigneeDetails from '../components/wizard/Step2ConsigneeDetails';
import Step3DrugInfo from '../components/wizard/Step3DrugInfo';
import Step4ManufacturerDetails from '../components/wizard/Step4ManufacturerDetails';
import Step5Shipments from '../components/wizard/Step5Shipments';
import Step5DocumentUpload from '../components/wizard/Step5DocumentUpload';
import Step6Declaration from '../components/wizard/Step6Declaration';
import Step7Review from '../components/wizard/Step7Review';
import Step8Success from '../components/wizard/Step8Success';
import './ApplyPage.css';

const STEPS = [
  Step1ApplicationDetails,   // 1
  Step2ConsigneeDetails,     // 2
  Step3DrugInfo,             // 3
  Step4ManufacturerDetails,  // 4
  Step5Shipments,            // 5 — NEW
  Step5DocumentUpload,       // 6 (was 5)
  Step6Declaration,          // 7 (was 6)
  Step7Review,               // 8 (was 7)
  Step8Success               // 9 (was 8)
];

export default function ApplyPage() {
  const { currentStep } = useApp();
  const StepComponent = STEPS[currentStep - 1];

  return (
    <div className="apply-page">
      <div className="apply-container">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <span>🏠 Home</span>
          <span className="bc-sep">›</span>
          <span>Export NOC</span>
          <span className="bc-sep">›</span>
          <span className="bc-active">Apply for Export NOC</span>
        </div>

        <div className="wizard-card">
          {currentStep < 9 && <ProgressBar currentStep={currentStep} />}
          <div className="wizard-body">
            <StepComponent />
          </div>
        </div>

        {/* Help Box */}
        {currentStep < 9 && (
          <div className="apply-help-box">
            <div className="help-box-icon">❓</div>
            <div>
              <strong>Need Help?</strong>
              <p>Contact CDSCO Helpdesk: <strong>1800-11-4477</strong> (Toll Free) | Mon–Fri 9AM–5:30PM</p>
              <p>Email: <strong>helpdesk-cdsco@nic.in</strong></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
