import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { REQUIRED_DOCUMENTS } from '../../data/mockData';
import { downloadFullApplicationPDF } from '../../utils/generatePDF';
import './WizardStep.css';

function ReviewSection({ title, icon, step, children, onEdit }) {
  return (
    <div className="review-section">
      <div className="review-section-header">
        <div className="review-section-title">
          <span>{icon}</span>
          <h3>{title}</h3>
        </div>
        <button className="btn btn-outline btn-sm" onClick={onEdit}>✏️ Edit</button>
      </div>
      <div className="review-section-body">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="review-row">
      <span className="review-label">{label}</span>
      <span className="review-value">{value}</span>
    </div>
  );
}

export default function Step7Review() {
  const { formData, setCurrentStep, submitToBackend } = useApp();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    const result = await submitToBackend();
    setSubmitting(false);
    if (result.success) {
      setCurrentStep(8);
    } else {
      // If backend offline, proceed anyway (graceful degradation)
      if (result.error && result.error.includes('fetch')) {
        setCurrentStep(8); // allow offline submission
      } else {
        setSubmitError(result.error || 'Submission failed. Please try again.');
      }
    }
  };

  const handleDownloadPDF = () => {
    downloadFullApplicationPDF(formData);
  };

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">🔍</div>
        <div>
          <h2>Application Review</h2>
          <p>Please review all information carefully before submitting your application</p>
        </div>
      </div>

      <div className="alert alert-warning">
        <span>⚠️</span>
        <span>Please review all sections carefully. Once submitted, the application cannot be modified. Use the <strong>Edit</strong> buttons to make corrections.</span>
      </div>

      {/* Application Details */}
      <ReviewSection title="Application Details" icon="📋" onEdit={() => setCurrentStep(1)}>
        <div className="review-grid">
          <ReviewRow label="Application Type" value={formData.applicationType} />
          <ReviewRow label="Export Purpose" value={formData.exportPurpose} />
          <ReviewRow label="Export Category" value={formData.exportCategory} />
          <ReviewRow label="Destination Country" value={formData.destinationCountry} />
          <ReviewRow label="Application Date" value={formData.applicationDate} />
          <ReviewRow label="Applicant Name" value={formData.applicantName} />
          <ReviewRow label="Organization" value={formData.applicantOrganization} />
          <ReviewRow label="Contact Number" value={formData.contactNumber} />
          <ReviewRow label="Email Address" value={formData.email} />
        </div>
      </ReviewSection>

      {/* Consignee */}
      <ReviewSection title="Consignee Information" icon="🏢" onEdit={() => setCurrentStep(2)}>
        <div className="review-grid">
          <ReviewRow label="Consignee Name" value={formData.consigneeName} />
          <ReviewRow label="Organization" value={formData.consigneeOrg} />
          <ReviewRow label="Address" value={[formData.addressLine1, formData.addressLine2, formData.city, formData.state, formData.postalCode, formData.consigneeCountry].filter(Boolean).join(', ')} />
          <ReviewRow label="Contact Person" value={formData.contactPerson} />
          <ReviewRow label="Phone" value={formData.consigneePhone} />
          <ReviewRow label="Email" value={formData.consigneeEmail} />
        </div>
      </ReviewSection>

      {/* Products */}
      <ReviewSection title={`Drug / Product Information (${formData.products.length} products)`} icon="💊" onEdit={() => setCurrentStep(3)}>
        {formData.products.length === 0 ? (
          <div className="alert alert-danger"><span>⚠️</span><span>No products added. Please go back and add products.</span></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product Name</th>
                  <th>Generic Name</th>
                  <th>Dosage Form</th>
                  <th>Strength</th>
                  <th>Batch No.</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {formData.products.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td><strong>{p.productName}</strong></td>
                    <td>{p.genericName}</td>
                    <td><span className="badge badge-info">{p.dosageForm}</span></td>
                    <td>{p.strength}</td>
                    <td><code>{p.batchNumber}</code></td>
                    <td>{p.expiryDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReviewSection>

      {/* Manufacturer */}
      <ReviewSection title="Manufacturer Details" icon="🏭" onEdit={() => setCurrentStep(4)}>
        <div className="review-grid">
          <ReviewRow label="Manufacturer Name" value={formData.manufacturerName} />
          <ReviewRow label="License Number" value={formData.mfgLicenseNo} />
          <ReviewRow label="Factory Address" value={formData.factoryAddress} />
          <ReviewRow label="Manufacturing Site" value={formData.manufacturingSite} />
          <ReviewRow label="Contact Person" value={formData.mfgContactPerson} />
          <ReviewRow label="Contact Number" value={formData.mfgContactNumber} />
          <ReviewRow label="Email" value={formData.mfgEmail} />
          <ReviewRow label="Authorized Signatory" value={formData.signatoryName} />
          <ReviewRow label="Designation" value={formData.signatoryDesignation} />
        </div>
      </ReviewSection>

      {/* Documents */}
      <ReviewSection title="Uploaded Documents" icon="📁" onEdit={() => setCurrentStep(5)}>
        <div className="docs-review-grid">
          {REQUIRED_DOCUMENTS.map(doc => {
            const uploaded = formData.documents[doc.id];
            return (
              <div key={doc.id} className={`doc-review-item ${uploaded ? 'doc-ok' : 'doc-missing'}`}>
                <span className="doc-review-icon">{uploaded ? '✅' : '❌'}</span>
                <div>
                  <div className="doc-review-label">{doc.label}{doc.required && <span className="required">*</span>}</div>
                  {uploaded ? (
                    <div className="doc-review-file">{uploaded.name}</div>
                  ) : (
                    <div className="doc-review-missing">{doc.required ? 'Required — Not uploaded' : 'Optional — Not uploaded'}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ReviewSection>

      {submitError && (
        <div className="alert alert-danger" style={{marginTop:12}}>
          <span>⚠️</span><span>{submitError}</span>
        </div>
      )}

      <div className="step-actions review-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(6)} disabled={submitting}>← Previous</button>
        <button className="btn btn-outline btn-primary-light" onClick={handleDownloadPDF} disabled={submitting}>
          ⬇ Download PDF
        </button>
        <button className="btn btn-success btn-lg" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '⏳ Submitting…' : '🚀 Submit Application'}
        </button>
      </div>
    </div>
  );
}
