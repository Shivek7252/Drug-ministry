// ============================================================
// MOCK DATA — Export NOC Portal
// ============================================================

export const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Argentina","Australia","Austria","Bangladesh",
  "Belgium","Brazil","Canada","Chile","China","Colombia","Denmark","Egypt",
  "Ethiopia","Finland","France","Germany","Ghana","Greece","Hungary","India",
  "Indonesia","Iran","Iraq","Ireland","Israel","Italy","Japan","Jordan","Kenya",
  "Kuwait","Malaysia","Mexico","Morocco","Myanmar","Nepal","Netherlands",
  "New Zealand","Nigeria","Norway","Oman","Pakistan","Peru","Philippines",
  "Poland","Portugal","Qatar","Romania","Russia","Saudi Arabia","Singapore",
  "South Africa","South Korea","Spain","Sri Lanka","Sudan","Sweden","Switzerland",
  "Tanzania","Thailand","Turkey","UAE","Uganda","UK","Ukraine","USA",
  "Uzbekistan","Vietnam","Yemen","Zambia","Zimbabwe"
];

export const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa",
  "Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala",
  "Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland",
  "Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura",
  "Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu & Kashmir",
  "Ladakh","Puducherry","Chandigarh","Andaman & Nicobar Islands","Lakshadweep",
  "Dadra & Nagar Haveli","Daman & Diu"
];

export const DOSAGE_FORMS = [
  "Tablet","Capsule","Syrup","Suspension","Injection","Cream","Ointment",
  "Gel","Lotion","Drops","Inhaler","Patch","Suppository","Powder","Granules",
  "Solution","Emulsion","Spray","Lozenge","Implant"
];

export const APPLICATION_TYPES = [
  "Fresh Application",
  "Renewal Application",
  "Amendment Application",
  "Duplicate Certificate"
];

export const EXPORT_PURPOSES = [
  "Commercial Export",
  "Sample Export",
  "Clinical Trial",
  "Donation / Humanitarian Aid",
  "Re-export",
  "Exhibition / Display"
];

export const EXPORT_CATEGORIES = [
  "Allopathic Drugs",
  "Ayurvedic / Herbal Products",
  "Homeopathic Products",
  "Biological Products",
  "Vaccines",
  "Medical Devices",
  "Cosmetics",
  "Nutraceuticals",
  "Veterinary Drugs"
];

export const MOCK_APPLICATIONS = [
  {
    id: "EXP-2026-000141",
    refNo: "REF-789650",
    applicant: "Sun Pharmaceutical Industries Ltd.",
    country: "USA",
    category: "Allopathic Drugs",
    status: "Approved",
    date: "2026-04-10",
    products: 3
  },
  {
    id: "EXP-2026-000142",
    refNo: "REF-789651",
    applicant: "Cipla Limited",
    country: "Germany",
    category: "Biological Products",
    status: "Under Review",
    date: "2026-04-18",
    products: 2
  },
  {
    id: "EXP-2026-000143",
    refNo: "REF-789652",
    applicant: "Dr. Reddy's Laboratories",
    country: "UK",
    category: "Allopathic Drugs",
    status: "Pending",
    date: "2026-05-01",
    products: 5
  },
  {
    id: "EXP-2026-000144",
    refNo: "REF-789653",
    applicant: "Lupin Limited",
    country: "Japan",
    category: "Vaccines",
    status: "Rejected",
    date: "2026-05-10",
    products: 1
  },
  {
    id: "EXP-2026-000145",
    refNo: "REF-789654",
    applicant: "Aurobindo Pharma",
    country: "Canada",
    category: "Allopathic Drugs",
    status: "Approved",
    date: "2026-05-20",
    products: 4
  }
];

export const TRACKING_TIMELINE = {
  "EXP-2026-000145": [
    { step: "Application Submitted", date: "20 May 2026, 10:32 AM", status: "completed", desc: "Application received and assigned reference number REF-789654" },
    { step: "Under Review", date: "21 May 2026, 09:15 AM", status: "completed", desc: "Application assigned to Drug Controller Officer for review" },
    { step: "Document Verification", date: "22 May 2026, 02:45 PM", status: "completed", desc: "All uploaded documents verified and found in order" },
    { step: "Compliance Check", date: "23 May 2026, 11:00 AM", status: "completed", desc: "Export compliance and regulatory requirements verified" },
    { step: "NOC Approved", date: "Pending", status: "pending", desc: "Awaiting final approval from Drug Controller General of India" }
  ],
  "EXP-2026-000141": [
    { step: "Application Submitted", date: "10 Apr 2026, 11:00 AM", status: "completed", desc: "Application received and assigned reference number REF-789650" },
    { step: "Under Review", date: "11 Apr 2026, 10:00 AM", status: "completed", desc: "Application assigned to Drug Controller Officer" },
    { step: "Document Verification", date: "13 Apr 2026, 03:00 PM", status: "completed", desc: "All documents verified" },
    { step: "Compliance Check", date: "15 Apr 2026, 12:00 PM", status: "completed", desc: "Compliance verified" },
    { step: "NOC Approved", date: "17 Apr 2026, 04:30 PM", status: "completed", desc: "NOC Certificate issued successfully" }
  ],
  "EXP-2026-000143": [
    { step: "Application Submitted", date: "01 May 2026, 09:00 AM", status: "completed", desc: "Application received" },
    { step: "Under Review", date: "02 May 2026, 10:30 AM", status: "completed", desc: "Under review by officer" },
    { step: "Document Verification", date: "In Progress", status: "inprogress", desc: "Documents are being verified" },
    { step: "Compliance Check", date: "Pending", status: "pending", desc: "Awaiting document verification" },
    { step: "NOC Approved", date: "Pending", status: "pending", desc: "Awaiting compliance check" }
  ]
};

export const CHART_DATA = {
  monthly: [
    { month: "Jan", applications: 42, approved: 35 },
    { month: "Feb", applications: 58, approved: 48 },
    { month: "Mar", applications: 65, approved: 52 },
    { month: "Apr", applications: 71, approved: 60 },
    { month: "May", applications: 88, approved: 72 },
    { month: "Jun", applications: 76, approved: 65 },
    { month: "Jul", applications: 92, approved: 78 },
    { month: "Aug", applications: 84, approved: 70 },
    { month: "Sep", applications: 95, approved: 82 },
    { month: "Oct", applications: 102, approved: 88 },
    { month: "Nov", applications: 89, approved: 76 },
    { month: "Dec", applications: 110, approved: 95 }
  ],
  countryExports: [
    { country: "USA", value: 245 },
    { country: "Germany", value: 189 },
    { country: "UK", value: 167 },
    { country: "Japan", value: 134 },
    { country: "Canada", value: 112 },
    { country: "Australia", value: 98 },
    { country: "UAE", value: 87 },
    { country: "Others", value: 320 }
  ],
  drugCategory: [
    { name: "Allopathic", value: 45 },
    { name: "Biological", value: 18 },
    { name: "Vaccines", value: 12 },
    { name: "Ayurvedic", value: 10 },
    { name: "Medical Devices", value: 8 },
    { name: "Others", value: 7 }
  ],
  approvalTrend: [
    { month: "Jan", rate: 83 },
    { month: "Feb", rate: 82 },
    { month: "Mar", rate: 80 },
    { month: "Apr", rate: 84 },
    { month: "May", rate: 81 },
    { month: "Jun", rate: 85 },
    { month: "Jul", rate: 84 },
    { month: "Aug", rate: 83 },
    { month: "Sep", rate: 86 },
    { month: "Oct", rate: 86 },
    { month: "Nov", rate: 85 },
    { month: "Dec", rate: 86 }
  ]
};

/* NOTIFICATIONS removed: it was a hardcoded array naming applications that do
   not exist (EXP-2026-000141 ...) with a constant unread count of 2. The navbar
   now derives notifications from the reviewer endpoint via
   hooks/useReviewerNotifications.js, which shares the queue's eligibility rule. */

export const REQUIRED_DOCUMENTS = [
  { id: "mfg_license", label: "Manufacturing License", required: true, hint: "Valid manufacturing license issued by State Drug Authority" },
  { id: "product_approval", label: "Product Approval Certificate", required: true, hint: "Certificate of approval for the drug product" },
  { id: "export_auth", label: "Export Authorization Letter", required: true, hint: "Authorization letter from company head/authorized signatory" },
  { id: "qa_cert", label: "Quality Assurance Certificate", required: true, hint: "GMP/ISO quality assurance certificate" },
  { id: "batch_analysis", label: "Batch Analysis Report", required: true, hint: "Analytical test report for the batch being exported" },
  { id: "product_info", label: "Product Information Sheet", required: false, hint: "Detailed product information / package insert (optional)" }
];
