import React, { createContext, useContext, useState } from 'react';

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
  const [formData, setFormData]     = useState(initialFormData);
  const [currentStep, setCurrentStep] = useState(1);
  const [submitted, setSubmitted]   = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [notifOpen, setNotifOpen]   = useState(false);

  // ── Auth ──────────────────────────────────────────────
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [loginOpen, setLoginOpen]     = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const login = (username) => {
    setIsLoggedIn(true);
    setCurrentUser(username);
    setLoginOpen(false);
  };

  const logout = () => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    resetForm();
  };
  // ─────────────────────────────────────────────────────

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
        [docId]: { name: file.name, size: file.size, type: file.type, uploadedAt: new Date().toLocaleTimeString() }
      }
    }));

  const removeDocument = (docId) =>
    setFormData(prev => { const docs = { ...prev.documents }; delete docs[docId]; return { ...prev, documents: docs }; });

  const updateDeclaration = (key, value) =>
    setFormData(prev => ({ ...prev, declarations: { ...prev.declarations, [key]: value } }));

  const saveDraft = () => { setDraftSaved(true); setTimeout(() => setDraftSaved(false), 3000); };

  const resetForm = () => { setFormData(initialFormData); setCurrentStep(1); setSubmitted(false); };

  return (
    <AppContext.Provider value={{
      formData, updateForm,
      addProduct, updateProduct, deleteProduct,
      addDocument, removeDocument,
      updateDeclaration,
      currentStep, setCurrentStep,
      submitted, setSubmitted,
      draftSaved, saveDraft,
      notifOpen, setNotifOpen,
      resetForm,
      // auth
      isLoggedIn, login, logout,
      loginOpen, setLoginOpen,
      currentUser
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
