import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Step3DrugInfo from './Step3DrugInfo';
import { checkGenericNameListed } from '../../hooks/useCdscoLookup';

/* ============================================================
   Step 3 generic-name gate

   A product may be added, and the step may advance, only when the generic
   name is listed in the CDSCO approved medicines register OR matches the
   Section 26A banned medicines list. A name in neither register is refused.
   ============================================================ */

/* Stand-in registers. `loaded` is flipped by the fetch-failure test. */
const mockRegistry = { loaded: true };
const mockApproved = [
  { id: 1, genericName: 'Paracetamol', strength: '500mg', indication: 'Fever', approvalDate: '12.04.1998' },
];
const mockBannedEntry = {
  sr: 61, name: 'Nimesulide', notification: 'GSR 82(E) dated 10.02.2011',
  status: 'prohibited', statusNote: '', scope: '', matchType: 'single',
};

jest.mock('../../data/approvedDrugs', () => ({
  loadApprovedDrugs: () => Promise.resolve(mockApproved),
  isApprovedListLoaded: () => mockRegistry.loaded,
  searchApprovedDrugs: (query, limit = 8) =>
    mockApproved
      .filter(d => d.genericName.toLowerCase().includes(String(query).trim().toLowerCase()))
      .slice(0, limit),
  findApprovedDrug: name =>
    mockApproved.find(d => d.genericName.toLowerCase() === String(name).trim().toLowerCase()) || null,
}));

jest.mock('../../data/bannedDrugs', () => ({
  loadBannedDrugs: () => Promise.resolve([]),
  isBannedListLoaded: () => mockRegistry.loaded,
  checkBannedDrug: name =>
    String(name).trim().toLowerCase() === 'nimesulide'
      ? { banned: true, totalMatches: 1, matches: [mockBannedEntry], primary: mockBannedEntry }
      : { banned: false, totalMatches: 0, matches: [], primary: null },
}));

const mockApp = {
  products: [],
  addProduct: jest.fn(),
  updateProduct: jest.fn(),
  deleteProduct: jest.fn(),
  setCurrentStep: jest.fn(),
  saveDraft: jest.fn(),
};

jest.mock('../../context/AppContext', () => ({
  useApp: () => ({
    formData: { products: mockApp.products },
    addProduct: mockApp.addProduct,
    updateProduct: mockApp.updateProduct,
    deleteProduct: mockApp.deleteProduct,
    setCurrentStep: mockApp.setCurrentStep,
    saveDraft: mockApp.saveDraft,
    draftSaved: false,
  }),
}));

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const savedProduct = (genericName, i = 1) => ({
  id: `p${i}`, productName: `Pack ${i}`, genericName, brandName: '',
  dosageForm: 'Tablet', strength: '500mg', packSize: '10x10',
  batchNumber: `B-${i}`, mfgDate: '2026-01-01', expiryDate: '2028-01-01',
});

/* Renders with both register loaders already settled, so `drugsLoaded` flips
   inside act() rather than mid-assertion. */
async function renderStep() {
  const utils = render(<Step3DrugInfo />);
  await act(async () => {});
  return utils;
}

function openAddForm() {
  fireEvent.click(screen.getByRole('button', { name: /Add Drug \/ Product/i }));
}

/* Fills every required field except the generic name, which the caller sets. */
function fillForm(container, genericName) {
  fireEvent.change(screen.getByPlaceholderText('Enter product name'), { target: { value: 'Pack A' } });
  fireEvent.change(screen.getByPlaceholderText(/Type to search CDSCO/i), { target: { value: genericName } });
  fireEvent.change(container.querySelector('select'), { target: { value: 'Tablet' } });
  fireEvent.change(screen.getByPlaceholderText(/Enter strength/i), { target: { value: '500mg' } });
  fireEvent.change(screen.getByPlaceholderText('Enter batch number'), { target: { value: 'B-1' } });
  const dates = container.querySelectorAll('input[type="date"]');
  fireEvent.change(dates[0], { target: { value: '2026-01-01' } });
  fireEvent.change(dates[1], { target: { value: '2028-01-01' } });
}

const clickAdd = () => fireEvent.click(screen.getByRole('button', { name: /➕ Add Product/ }));
const clickNext = () => fireEvent.click(screen.getByRole('button', { name: /Next: Manufacturer Details/i }));

beforeEach(() => {
  mockRegistry.loaded = true;
  mockApp.products = [];
  jest.clearAllMocks();
});

/* ── The rule itself ─────────────────────────────────────────────────────── */

describe('checkGenericNameListed', () => {
  test('accepts a name in the approved medicines list', () => {
    expect(checkGenericNameListed('Paracetamol').admissible).toBe(true);
  });

  test('accepts a name matched against the banned medicines list', () => {
    const listed = checkGenericNameListed('Nimesulide');
    expect(listed.admissible).toBe(true);
    expect(listed.severity).toBe('banned');
  });

  test('refuses a name in neither list, and names it in the reason', () => {
    const listed = checkGenericNameListed('Zorbaxin');
    expect(listed.admissible).toBe(false);
    expect(listed.severity).toBe('notFound');
    expect(listed.reason).toMatch(/Zorbaxin/);
    expect(listed.reason).toMatch(/CDSCO approved medicines list/i);
  });

  test('an empty name is still just Required', () => {
    expect(checkGenericNameListed('   ')).toEqual({ admissible: false, severity: null, reason: 'Required' });
  });

  test('never blocks while a register is unavailable — a failed fetch must not refuse everything', () => {
    mockRegistry.loaded = false;
    expect(checkGenericNameListed('Zorbaxin').admissible).toBe(true);
  });
});

/* ── Adding a product ────────────────────────────────────────────────────── */

describe('adding a product', () => {
  test('an unlisted generic name is refused with a validation error', async () => {
    const { container } = await renderStep();
    openAddForm();
    fillForm(container, 'Zorbaxin');
    clickAdd();

    expect(mockApp.addProduct).not.toHaveBeenCalled();
    expect(screen.getByText(/“Zorbaxin” is not in the CDSCO approved medicines list/)).toBeInTheDocument();
    // The form stays open so the name can be corrected.
    expect(screen.getByPlaceholderText(/Type to search CDSCO/i)).toBeInTheDocument();
  });

  test('an approved generic name is added', async () => {
    const { container } = await renderStep();
    openAddForm();
    fillForm(container, 'Paracetamol');
    clickAdd();

    expect(mockApp.addProduct).toHaveBeenCalledTimes(1);
    expect(mockApp.addProduct.mock.calls[0][0]).toMatchObject({
      genericName: 'Paracetamol', cdscoApproved: true, complianceSeverity: 'approved',
    });
  });

  test('a banned generic name is added — it is listed, and the reviewer sees the Section 26A flag', async () => {
    const { container } = await renderStep();
    openAddForm();
    fillForm(container, 'Nimesulide');
    clickAdd();

    expect(mockApp.addProduct).toHaveBeenCalledTimes(1);
    expect(mockApp.addProduct.mock.calls[0][0]).toMatchObject({
      genericName: 'Nimesulide', complianceSeverity: 'banned', gazetteSr: 61,
    });
  });

  test('the error clears as soon as the name is edited', async () => {
    const { container } = await renderStep();
    openAddForm();
    fillForm(container, 'Zorbaxin');
    clickAdd();
    expect(screen.getByText(/is not in the CDSCO approved medicines list/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Type to search CDSCO/i), { target: { value: 'Paracetamol' } });
    expect(screen.queryByText(/is not in the CDSCO approved medicines list/)).not.toBeInTheDocument();

    clickAdd();
    expect(mockApp.addProduct).toHaveBeenCalledTimes(1);
  });
});

/* ── Advancing to Step 4 ─────────────────────────────────────────────────── */

describe('continuing to the next stage', () => {
  test('an unlisted product already in the table blocks the step and is called out', async () => {
    mockApp.products = [savedProduct('Zorbaxin')];
    await renderStep();

    // Rendered once both registers have loaded.
    expect(await screen.findByText(/1 added product cannot be verified/i)).toBeInTheDocument();

    clickNext();
    expect(mockApp.setCurrentStep).not.toHaveBeenCalled();
    expect(screen.getByText(/Correct or remove Zorbaxin/i)).toBeInTheDocument();
  });

  test('listed products let the step advance', async () => {
    mockApp.products = [savedProduct('Paracetamol', 1), savedProduct('Nimesulide', 2)];
    await renderStep();

    expect(await screen.findByText(/flagged\s+under Section 26A/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be verified/i)).not.toBeInTheDocument();

    clickNext();
    expect(mockApp.setCurrentStep).toHaveBeenCalledWith(4);
  });
});
