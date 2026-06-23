# TECHNICAL & FINANCIAL PROPOSAL

## Design & Development of

# CDSCO Export NOC Approval Process Portal

### *An end-to-end digital platform with AI-powered document verification, forgery detection and approval workflow*

---

**Submitted to:** Central Drugs Standard Control Organisation (CDSCO), Directorate General of Health Services, Ministry of Health and Family Welfare, Government of India

**Submitted by:** Anuvadini Foundation (C/o AICTE), Nelson Mandela Marg, Vasant Kunj, New Delhi – 110070

**Classification:** Confidential

---

## 1. About Anuvadini Foundation

Anuvadini AI aims to bridge the digital divide by developing advanced, future-ready AI solutions that enable affordable infrastructure and services, promote regional language education, and support the socio-economic upliftment of the common citizen — particularly in rural areas.

Developed by **Anuvadini Foundation**, a Section 8 organisation under **AICTE, Ministry of Education**, the platform leverages indigenous AI, BI and DI technologies to deliver multilingual translation of audio, video and text across **22 Indian and 89 foreign languages** — while enhancing digital infrastructure, improving efficiency, and supporting large-scale deployments across government departments, PSUs, academic institutions and startups.

### 1.1 Our Experience & Capabilities

As a not-for-profit technology body operating within the Ministry of Education ecosystem, Anuvadini Foundation brings deep, hands-on experience in building secure, scalable and compliant digital platforms for ministry-level and regulatory audiences. Our relevant strengths include:

- **Government-grade platform engineering** — design and delivery of web portals, dashboards and data pipelines for departments, regulatory bodies, PSUs and academic institutions, built to government data-security and accessibility standards.
- **AI-powered document intelligence** — in-house pipelines for OCR of scanned regulatory documents, checklist-driven verification of statutory submissions, evidence-grounded reasoning with large language models, and detection of tampered or forged credentials.
- **Workflow & approval systems** — domain expertise in multi-stage, role-based approval workflows involving applications, document verification, inspections, committee review and automated correspondence.
- **Indigenous AI, BI & DI stack** — in-house AI, Business Intelligence and Data Intelligence capability enabling intelligent search, MIS analytics, multilingual interfaces and automation across 22 Indian and 89 foreign languages.
- **Trusted institutional standing** — operating C/o AICTE, Nelson Mandela Marg, New Delhi, with established processes for confidentiality, data security and reliable post-deployment support.
- **Proven delivery model** — dedicated technical teams, structured build phases, defined SLAs and quarterly feature updates ensuring continuity well beyond go-live.

---

## 2. Project Understanding

The **Central Drugs Standard Control Organisation (CDSCO)**, under the Directorate General of Health Services, Ministry of Health and Family Welfare, is the national regulatory authority for drugs, cosmetics and medical devices in India. Among its many statutory functions, CDSCO and the State Drug Authorities issue the **Export No Objection Certificate (NOC)** required by Indian pharmaceutical manufacturers for the export of finished formulations, bulk drugs and unapproved/new drugs to foreign markets.

The current Export NOC issuance process involves the submission of multiple statutory documents — Integrated Registration Form (IRF), legal undertakings on non-judicial stamp paper, manufacturing licenses (Form-25 / 28 / 28D / Loan Licence / DSIR), product approval certificates, importing-country regulatory approvals (NRA), historical export data, batch analysis and quality assurance certificates — all of which today must be manually scrutinised by reviewing officers. This is time consuming, error prone and increasingly vulnerable to a **growing concern across CDSCO and State Drug Authorities: the submission of forged or tampered documents — including fabricated drug approval letters, manipulated manufacturing licenses, counterfeit NOCs and altered test reports.**

The **CDSCO Export NOC Approval Process Portal** is envisaged as a single, transparent, end-to-end digital platform that manages the complete lifecycle of an Export NOC application — from online submission and AI-driven document verification through reviewer scrutiny and decision to letter generation and audit-ready record keeping.

Anuvadini Foundation proposes to **design, develop and maintain** this portal (web portal & mobile application) with a configurable workflow engine, role-based access, secure document management, **AI-powered checklist verification, OCR-based searchable scanned documents, and tamper / forgery detection**, and a rich analytics layer — enabling CDSCO to administer the approval process efficiently while giving applicant pharmaceutical companies full visibility of their application status.

### 2.1 Indicative Scope of the Portal

- **Online application module** for Export NOC submissions covering finished formulations, bulk drugs, unapproved / investigational drugs, and increase-in-quantity requests by pharmaceutical exporters.
- **Multi-step application wizard** for product, consignee, manufacturer, signatory and statutory document submission.
- **Secure document repository** with versioning for the full Export NOC checklist — IRF, Annexure-II legal undertaking, Manufacturing License copies, Product Approval, NRA / CDSCO importing-country approval, Batch Analysis, QA / GMP certificates, historical Export NOC records and supporting evidence.
- **AI-powered Document Verification Engine** (the core differentiator) — every uploaded document is automatically read, OCR'd if scanned, and verified against the Export NOC checklist by a Large Language Model running in strict JSON-grounded mode. For every item the engine returns a YES/NO decision, an exact **evidence quote** from the document, and the **page number** where the evidence appears. The reviewer can click any verified item to jump straight to that text inside the PDF viewer.
- **Searchable Scanned Documents** — for image-only PDFs (a common scenario for stamp-paper undertakings, foreign NRA certificates and printed approvals), the platform OCRs every page using `mistral-ocr-latest` and renders the recovered text as a selectable, searchable, highlight-able layer over the original scan.
- **Forgery & Tampering Detection** — addressing the rising threat of fabricated approval letters, manipulated manufacturing licenses, counterfeit NOCs and altered test reports. The platform performs:
  - **Structural template validation** — matches the document against the prescribed CDSCO template fingerprint (must-contain / must-not-contain phrases, minimum length, regulatory keywords) before any AI step.
  - **AI cross-checking** — the LLM is required to ground every "present" claim in an exact verbatim quote; if no quote can be produced the claim is auto-downgraded to "unverified", preventing model hallucination.
  - **Cross-reference detection** — automatic flagging when license numbers, manufacturer names or dates inside one document contradict those in another document of the same application.
  - **Visual integrity checks** — detection of overlaid stamps / signatures, font-mismatch regions, recompressed image artefacts, and metadata inconsistencies (digital editing history, generator software).
  - **Tamper score** per document with an audit-ready explanation of every flag raised.
- **Configurable, multi-stage approval workflow** — auto-scrutiny, AI verification, reviewer assignment, decision (Approved / Query Raised / Rejected), mismatch escalation, and committee review where required.
- **Role-based dashboards** for applicant exporters, CDSCO reviewers, supervising officers and administrators.
- **Automated correspondence** — Export NOC issuance letter, deficiency / query letters, rejection orders, with email and SMS notifications at each stage.
- **MIS, analytics and reporting layer** with drill-down dashboards for application volume, turnaround time, rejection categories, forgery hit-rate and exporter compliance trends — plus audit trails and exportable reports.
- **Government-standard security**, access control, data protection and audit logging across the full application lifecycle.

### 2.2 Key Technology Highlights

| Capability | Technology / Approach |
|---|---|
| Frontend (Web Portal) | React, accessible UI, in-browser PDF viewer with OCR + search highlighting |
| Backend (APIs) | Node.js / Express, REST APIs, MongoDB persistence |
| AI Verification | `mistral-large-latest` in strict-JSON mode with evidence-grounded reasoning |
| OCR for Scanned PDFs | `mistral-ocr-latest` document endpoint, per-page markdown output |
| Forgery Detection | Template fingerprinting + LLM cross-check + visual / metadata heuristics |
| Multilingual Support | Anuvadini AI — 22 Indian + 89 foreign languages |
| Mobile | Cross-platform mobile application for applicants and field officers |

---

## 3. Financial Proposal

The commercial proposal comprises three components: **(A)** one-time Development Cost, **(B)** monthly Manpower Cost for ongoing support and enhancement, and **(C)** annual Maintenance Cost (AMC). The server / hosting infrastructure is recommended separately to CDSCO and is **not part** of this commercial quote (see Section 4).

### 3.1 Component A — Development Cost (One-Time)

| Particular | Amount |
|---|---:|
| Design & Development of CDSCO Export NOC Approval Process Portal (Web Portal & Mobile Application) including AI Verification & Forgery Detection modules | ₹ 1,80,00,000 |
| GST @ 18% | ₹ 32,40,000 |
| **Total Development Cost (incl. GST)** | **₹ 2,12,40,000** |

### 3.2 Component B — Manpower Cost (Monthly)

Dedicated manpower will be deployed for ongoing operations, support, reporting and continuous enhancement of the portal. Two pricing options are offered depending on the deployment location of the team.

**Option 1 — Team seated at Anuvadini, AICTE office**

| Resource | No. of Count | Rate per month |
|---|:---:|---:|
| Senior Developer | 1 | ₹ 1,30,000 |
| Junior Developer | 1 | ₹ 90,000 |
| Report & Data Analyst | 1 | ₹ 70,000 |
| **Total — Option 1** | **3** | **₹ 2,90,000** |

*Note: GST will be applicable as per govt norms.*

**Option 2 — Team seated at CDSCO office**

| Resource | No. of Count | Rate per month |
|---|:---:|---:|
| Senior Developer | 1 | ₹ 1,70,000 |
| Junior Developer | 1 | ₹ 1,20,000 |
| Report & Data Analyst | 1 | ₹ 90,000 |
| **Total — Option 2** | **3** | **₹ 3,80,000** |

*Note: GST will be applicable as per govt norms.*

### 3.3 Component C — Annual Maintenance Cost (AMC)

| Particular | Amount per year |
|---|---:|
| Annual Maintenance Contract (AMC) — support, bug-fixes, minor enhancements, security patching, uptime maintenance, AI-model upgrades & quarterly updates | ₹ 18,00,000 |
| **Total AMC** | **₹ 18,00,000** |

*Note: AMC becomes applicable after the post go-live warranty / support period and is renewable annually.*

### 3.4 Commercial Summary

| Sr. No. | Component | Cost | Frequency |
|:---:|---|---:|---|
| 1 | Development Cost (₹ 1.80 Cr + 18% GST) | ₹ 2,12,40,000 | One-Time |
| 2 | Manpower — Option 1 (at Anuvadini / AICTE) | ₹ 2,90,000 | Per Month + GST |
| 3 | Manpower — Option 2 (at CDSCO office) | ₹ 3,80,000 | Per Month + GST |
| 4 | Annual Maintenance Cost (AMC) | ₹ 18,00,000 | Per Year |

*GST treatment: Development Cost is quoted inclusive of GST (₹ 2,12,40,000/-). Manpower and AMC charges are inclusive of GST @ 18% as per the billing terms in Section 5.*

---

## 4. Recommended Server Configuration

The server / hosting infrastructure is recommended to be provisioned and owned by CDSCO. The configuration below is a suggestion only; **no server / hosting cost** is included in this proposal.

| Component | Suggested Configuration | Purpose |
|---|---|---|
| Application / Web Servers | 2 × instances (HA) — 8 vCPU, 32 GB RAM, 200 GB SSD each | Portal application & API layer |
| Database Server | 8 vCPU, 64 GB RAM, 500 GB SSD (with replica for HA) | Application & workflow data |
| Object / File Storage | 2–4 TB scalable storage | Documents, scanned uploads, evidence |
| AI / OCR Worker Node | 4 vCPU, 16 GB RAM (or managed Mistral API access) | OCR pipeline, AI verification, forgery checks |
| Cache / Queue Server | 4 vCPU, 16 GB RAM | Sessions, jobs, notifications |
| Load Balancer & SSL | Managed load balancer with SSL / TLS termination | High availability & secure access |
| Backup & DR Storage | Storage equal to primary, with daily automated backups | Business continuity |
| Staging / UAT Environment | Scaled-down replica — 4 vCPU, 16 GB RAM | Testing & pre-release validation |
| Security | WAF, firewall, anti-virus, periodic VAPT, CERT-In compliance | Government-grade security |
| Operating System & Network | Ubuntu Server LTS / RHEL, static IP, domain & SSL, adequate bandwidth | Hosting environment |

*Final sizing can be optimised jointly with CDSCO's IT / AF team based on the expected number of exporters, concurrent users, document volumes and AI-verification throughput.*

---

## 5. Work Order, Terms & Conditions & Billing Process Terms

- **Work Order:** The work order shall be issued in the name of **Anuvadini Foundation, C/o AICTE, Nelson Mandela Marg, Vasant Kunj, New Delhi – 110070**.
- The scope of work is limited to the design, development, testing, deployment, and support of the **CDSCO Export NOC Approval Process Portal (Web Portal & Mobile Application)**, including the AI Document Verification and Forgery Detection modules, as defined in this proposal.
- Any additional features, integrations, reports, or modifications beyond the agreed scope shall be treated as **change requests** and may require additional cost and timeline approval.
- CDSCO shall provide all necessary approvals, inputs, and infrastructure support required for timely project execution.
- The project shall be deemed completed upon successful **UAT and formal sign-off** by CDSCO.
- All data generated through the portal shall remain the **property of CDSCO**, and Anuvadini Foundation shall maintain strict confidentiality.
- A **warranty / support period of 12 months** from Go-Live shall be provided; AMC, if opted for, shall commence thereafter.
- **GST:** All prices mentioned above are exclusive of GST (18%), except the Development Cost which is quoted at ₹ 1.80 Cr plus GST @ 18%.
- **Payment:** 50% of the total project cost shall be payable as an advance upon award of the work order and commencement of the design and development of the Web Portal and Mobile Application. The remaining 50% of the total project cost shall be payable upon successful completion of development, User Acceptance Testing (UAT), and formal sign-off by the client.
- **Confidentiality & Data Security:** All shared documents and data will be handled with strict confidentiality and in compliance with government data-security standards and CERT-In guidelines.

---

**Regards,**

**Dr. Buddha Chandrasekhar**
Chief Executive Officer
Anuvadini Foundation, All India Council for Technical Education (AICTE)
Ministry of Education, Government of India
Mobile: 9740169197
Office Landline: +91 11 29581423
Email: cconeat@aicte-india.org
