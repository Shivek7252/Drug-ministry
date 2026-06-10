import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { saveDraft, submitApplication } from '../api/applicationService';

const AppContext = createContext();

const initialFormData = {
  applicationType: '',
  exportPurpose: '',
  exportCategory: '',
  destinationCountry: '',
  applicationDate: new Date().toISOString().split('T')[0],
  applicantName: '',
  applicantOrganization: '',
  contactNumber: '',
  email: '',
  consigneeName: '',
  consigneeOrg: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  consigneeCountry: '',
  postalCode: '',
  contactPerson: '',
  consigneePhone: '',
  consigneeEmail: '',
  products: [],
  manufacturerName: '',
  mfgLicenseNo: '',
  factoryAddress: '',
  manufacturingSite: '',
  mfgContactPerson: '',
  mfgContactNumber: '',
  mfgEmail: '',
  signatoryName: '',
  signatoryDesignation: '',
  documents: {},
  declarations: {
    productInfoAccurate: false,
    documentsGenuine: false,
    exportRegulations: false,
    drugComplies: false,
    finalDeclaration: false
  }
};

export function AppProvider({ children }) {
  const [formData, setFormData]         = useState(initialFormData);
  const [currentStep, setCurrentStep]   = useState(1);
  const [submitted, setSubmitted]       = useState(false);
  const [draftSaved, setDraftSaved]     = useState(false);
  const [notifOpen, setNotifOpen]       = useState(false);
  const [submittedAppNo, setSubmittedAppNo] = useState('');
  const [submittedRefNo, setSubmittedRefNo] = useState('');
  const autoSaveTimer = useRef(null);

  // ── Auth ──────────────────────────────────────────────
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [loginOpen, setLoginOpen]     = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole]       = useState('applicant'); // 'applicant' | 'reviewer'

  const login = (username, role = 'applicant') => {
    setIsLoggedIn(true);
    setCurrentUser(username);
    setUserRole(role);
    setLoginOpen(false);
  };

  const logout = () => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setUserRole('applicant');
    resetForm();
  };

  // ── Auto-save draft every 30s when form has data ──────
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    // Only auto-save if user has entered meaningful data
    if (!formData.email && !formData.applicantName) return;
    autoSaveTimer.current = setTimeout(async () => {
      const result = await saveDraft(formData, currentUser || 'anonymous');
      if (result.success) {
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 2000);
      }
    }, 30000); // 30s debounce
    return () => clearTimeout(autoSaveTimer.current);
  }, [formData]); // eslint-disable-line

  const updateForm = (fields) => setFormData(prev => ({ ...prev, ...fields }));

  const addProduct = (product) =>
    setFormData(prev => ({ ...prev, products: [...prev.products, { ...product, id: Date.now() }] }));

  const updateProduct = (id, product) =>
    setFormData(prev => ({ ...prev, products: prev.products.map(p => p.id === id ? { ...product, id } : p) }));

  const deleteProduct = (id) =>
    setFormData(prev => ({ ...prev, products: prev.products.filter(p => p.id !== id) }));

  const addDocument = (docId, file) =>
    setFormData(prev => ({
      ...prev,
      documents: {
        ...prev.documents,
        [docId]: {
          name: file.name,
          size: file.size,
          type: file.type,
          uploadedAt: new Date().toLocaleTimeString(),
          objectUrl: file.objectUrl || '',
          data: file.data || ''
        }
      }
    }));

  const removeDocument = (docId) =>
    setFormData(prev => { const docs = { ...prev.documents }; delete docs[docId]; return { ...prev, documents: docs }; });

  const updateDeclaration = (key, value) =>
    setFormData(prev => ({ ...prev, declarations: { ...prev.declarations, [key]: value } }));

  // ── Manual save draft ─────────────────────────────────
  const saveDraftManual = useCallback(async () => {
    const result = await saveDraft(formData, currentUser || 'anonymous');
    if (result.success) {
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    }
  }, [formData, currentUser]);

  // ── Submit application to backend ─────────────────────
  const submitToBackend = useCallback(async () => {
    const result = await submitApplication(formData, currentUser || 'anonymous');
    if (result.success) {
      setSubmittedAppNo(result.applicationNumber);
      setSubmittedRefNo(result.referenceNumber);
      setSubmitted(true);
    }
    return result;
  }, [formData, currentUser]);

  const resetForm = () => {
    setFormData(initialFormData);
    setCurrentStep(1);
    setSubmitted(false);
    setSubmittedAppNo('');
    setSubmittedRefNo('');
  };

  return (
    <AppContext.Provider value={{
      formData, updateForm,
      addProduct, updateProduct, deleteProduct,
      addDocument, removeDocument,
      updateDeclaration,
      currentStep, setCurrentStep,
      submitted, setSubmitted,
      draftSaved, saveDraft: saveDraftManual,
      submittedAppNo, submittedRefNo,
      submitToBackend,
      notifOpen, setNotifOpen,
      resetForm,
      // auth
      isLoggedIn, login, logout,
      loginOpen, setLoginOpen,
      currentUser, userRole
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
