import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { saveDraft, submitApplication } from '../api/applicationService';

const AppContext = createContext();

/* Small ref helper — client-side ids for cross-referencing arrays */
const newRef = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e5).toString(36)}`;

const emptyCompany = () => ({
  companyRef:           newRef('co'),
  name:                 '',
  licenseNo:            '',
  factoryAddress:       '',
  manufacturingSite:    '',
  contactPerson:        '',
  contactNumber:        '',
  email:                '',
  signatoryName:        '',
  signatoryDesignation: '',
});

const emptyConsignee = () => ({
  consigneeRef:  newRef('cn'),
  name:          '',
  organisation:  '',
  addressLine1:  '',
  addressLine2:  '',
  city:          '',
  state:         '',
  country:       '',
  postalCode:    '',
  contactPerson: '',
  phone:         '',
  email:         '',
});

const emptyShipment = () => ({
  shipmentRef:  newRef('sh'),
  companyRef:   '',
  productRef:   '',
  consigneeRef: '',
  quantity:     '',
  packSize:     '',
  batchNumbers: [],
});

const initialFormData = {
  applicationType: '',
  exportPurpose: '',
  exportCategory: '',
  destinationCountry: '',   // legacy — first consignee's country mirrored for back-compat
  applicationDate: new Date().toISOString().split('T')[0],
  applicantName: '',
  applicantOrganization: '',
  contactNumber: '',
  email: '',
  // Legacy single-consignee fields (mirrored from consignees[0] on save)
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
  // Legacy single-manufacturer fields (mirrored from companies[0] on save)
  manufacturerName: '',
  mfgLicenseNo: '',
  factoryAddress: '',
  manufacturingSite: '',
  mfgContactPerson: '',
  mfgContactNumber: '',
  mfgEmail: '',
  signatoryName: '',
  signatoryDesignation: '',
  // NEW multi-row arrays
  companies:  [emptyCompany()],
  consignees: [emptyConsignee()],
  products: [],
  shipments: [],
  documents: {},
  declarations: {
    productInfoAccurate: false,
    documentsGenuine: false,
    exportRegulations: false,
    drugComplies: false,
    finalDeclaration: false
  }
};

export { emptyCompany, emptyConsignee, emptyShipment, newRef };

export function AppProvider({ children }) {
  const [formData, setFormData]         = useState(initialFormData);
  const [currentStep, setCurrentStep]   = useState(1);
  const [submitted, setSubmitted]       = useState(false);
  const [draftSaved, setDraftSaved]     = useState(false);
  const [notifOpen, setNotifOpen]       = useState(false);
  const [submittedAppNo, setSubmittedAppNo]   = useState('');
  const [submittedRefNo, setSubmittedRefNo]   = useState('');
  const [drugWarnings, setDrugWarnings]       = useState([]);   // warnings from CDSCO approval check
  const [allDrugsApproved, setAllDrugsApproved] = useState(true);
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
      const result = await saveDraft(mirrorLegacyFields(formData), currentUser || 'anonymous');
      if (result.success) {
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 2000);
      }
    }, 30000); // 30s debounce
    return () => clearTimeout(autoSaveTimer.current);
  }, [formData]); // eslint-disable-line

  const updateForm = (fields) => setFormData(prev => ({ ...prev, ...fields }));

  const addProduct = (product) =>
    setFormData(prev => ({
      ...prev,
      products: [
        ...prev.products,
        { ...product, id: Date.now(), productRef: product.productRef || newRef('p') },
      ],
    }));

  const updateProduct = (id, product) =>
    setFormData(prev => ({ ...prev, products: prev.products.map(p => p.id === id ? { ...product, id, productRef: p.productRef } : p) }));

  const deleteProduct = (id) =>
    setFormData(prev => ({ ...prev, products: prev.products.filter(p => p.id !== id) }));

  /* ── Companies (manufacturers) ─────────────────────────── */
  const addCompany = () =>
    setFormData(prev => ({ ...prev, companies: [...prev.companies, emptyCompany()] }));

  const updateCompany = (companyRef, patch) =>
    setFormData(prev => ({
      ...prev,
      companies: prev.companies.map(c => c.companyRef === companyRef ? { ...c, ...patch } : c),
    }));

  const deleteCompany = (companyRef) =>
    setFormData(prev => ({
      ...prev,
      companies: prev.companies.filter(c => c.companyRef !== companyRef),
      shipments: prev.shipments.filter(s => s.companyRef !== companyRef),
    }));

  /* ── Consignees (destinations) ─────────────────────────── */
  const addConsignee = () =>
    setFormData(prev => ({ ...prev, consignees: [...prev.consignees, emptyConsignee()] }));

  const updateConsignee = (consigneeRef, patch) =>
    setFormData(prev => ({
      ...prev,
      consignees: prev.consignees.map(c => c.consigneeRef === consigneeRef ? { ...c, ...patch } : c),
    }));

  const deleteConsignee = (consigneeRef) =>
    setFormData(prev => ({
      ...prev,
      consignees: prev.consignees.filter(c => c.consigneeRef !== consigneeRef),
      shipments: prev.shipments.filter(s => s.consigneeRef !== consigneeRef),
    }));

  /* ── Shipments (line items) ────────────────────────────── */
  const addShipment = (patch = {}) =>
    setFormData(prev => ({ ...prev, shipments: [...prev.shipments, { ...emptyShipment(), ...patch }] }));

  const updateShipment = (shipmentRef, patch) =>
    setFormData(prev => ({
      ...prev,
      shipments: prev.shipments.map(s => s.shipmentRef === shipmentRef ? { ...s, ...patch } : s),
    }));

  const deleteShipment = (shipmentRef) =>
    setFormData(prev => ({
      ...prev,
      shipments: prev.shipments.filter(s => s.shipmentRef !== shipmentRef),
    }));

  const replaceShipments = (rows) =>
    setFormData(prev => ({ ...prev, shipments: rows }));

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

  /* Mirror the first companies[]/consignees[] row into the legacy top-level
     fields so old reports / reviewer views keep working. Called just before
     save/submit so we never persist stale mirrors. */
  const mirrorLegacyFields = (fd) => {
    const co = (fd.companies || [])[0] || {};
    const cn = (fd.consignees || [])[0] || {};
    return {
      ...fd,
      // manufacturer mirror
      manufacturerName:     co.name                 || fd.manufacturerName,
      mfgLicenseNo:         co.licenseNo            || fd.mfgLicenseNo,
      factoryAddress:       co.factoryAddress       || fd.factoryAddress,
      manufacturingSite:    co.manufacturingSite    || fd.manufacturingSite,
      mfgContactPerson:     co.contactPerson        || fd.mfgContactPerson,
      mfgContactNumber:     co.contactNumber        || fd.mfgContactNumber,
      mfgEmail:             co.email                || fd.mfgEmail,
      signatoryName:        co.signatoryName        || fd.signatoryName,
      signatoryDesignation: co.signatoryDesignation || fd.signatoryDesignation,
      // consignee mirror
      consigneeName:    cn.name         || fd.consigneeName,
      consigneeOrg:     cn.organisation || fd.consigneeOrg,
      addressLine1:     cn.addressLine1 || fd.addressLine1,
      addressLine2:     cn.addressLine2 || fd.addressLine2,
      city:             cn.city         || fd.city,
      state:            cn.state        || fd.state,
      consigneeCountry: cn.country      || fd.consigneeCountry,
      destinationCountry: cn.country    || fd.destinationCountry,
      postalCode:       cn.postalCode   || fd.postalCode,
      contactPerson:    cn.contactPerson|| fd.contactPerson,
      consigneePhone:   cn.phone        || fd.consigneePhone,
      consigneeEmail:   cn.email        || fd.consigneeEmail,
    };
  };

  // ── Manual save draft ─────────────────────────────────
  const saveDraftManual = useCallback(async () => {
    const result = await saveDraft(mirrorLegacyFields(formData), currentUser || 'anonymous');
    if (result.success) {
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    }
  }, [formData, currentUser]);

  // ── Submit application to backend ─────────────────────
  const submitToBackend = useCallback(async () => {
    const result = await submitApplication(mirrorLegacyFields(formData), currentUser || 'anonymous');
    if (result.success) {
      setSubmittedAppNo(result.applicationNumber);
      setSubmittedRefNo(result.referenceNumber);
      setDrugWarnings(result.drugWarnings || []);
      setAllDrugsApproved(result.allDrugsApproved !== false);
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
    setDrugWarnings([]);
    setAllDrugsApproved(true);
  };

  return (
    <AppContext.Provider value={{
      formData, updateForm,
      addProduct, updateProduct, deleteProduct,
      addCompany, updateCompany, deleteCompany,
      addConsignee, updateConsignee, deleteConsignee,
      addShipment, updateShipment, deleteShipment, replaceShipments,
      addDocument, removeDocument,
      updateDeclaration,
      currentStep, setCurrentStep,
      submitted, setSubmitted,
      draftSaved, saveDraft: saveDraftManual,
      submittedAppNo, submittedRefNo,
      drugWarnings, allDrugsApproved,
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
