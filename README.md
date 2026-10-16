# CDSCO Export NOC Portal (Drug Ministry)

A web portal for applying for, reviewing, and tracking **Export NOCs (No Objection
Certificates)** for drugs, modelled on the CDSCO export workflow. Applicants fill a
multi-step application and upload supporting documents. Reviewers work through a
queue with AI-assisted document checks, raise queries, and approve or reject.

The repository holds three apps:

| Folder | What it is | Stack | Default port |
| --- | --- | --- | --- |
| [`frontend/`](frontend/) | Applicant and reviewer web UI | React 19 (Create React App), React Router, Recharts, pdf.js | `3000` |
| [`backend/`](backend/) | REST API, auth, storage, AI document verification | Node.js, Express, MongoDB (Mongoose), Mistral AI | `5001` |
| [`tampering/`](tampering/) | Standalone document-forensics service (tamper detection) | Python, FastAPI | `8000` |

---

## Features

**Applicant side** (`/`, `/apply`, `/track`)
- Dashboard of your own applications and their status.
- 8-step application wizard: application details, consignee, drug info, manufacturer,
  document upload, shipments, declaration, review and submit.
- Drug compliance alerts: checks the drug against the approved list
  ([`approved_drugs.xlsx`](approved_drugs.xlsx)) and the banned list
  ([`banneddrugs.pdf`](banneddrugs.pdf)).
- Save drafts, track submitted applications, reply to reviewer queries with new documents.
- Post-approval shipment reconciliation.

**Reviewer side** (`/review`)
- Review queue with filters, KPIs, CSV export, and unread tracking.
- Analytics: status split, pipeline funnel, processing time, submission trend,
  destination countries, category mix.
- Application detail view: document viewer, AI pre-verification of each uploaded
  document, per-document and per-checklist queries with full query history,
  per-shipment actions, approve or reject.

**AI document verification (backend)**
- Uploaded PDFs are text-extracted (`pdf-parse`). Scanned PDFs fall back to Mistral OCR.
- Mistral chat models check whether each document is complete and matches the
  application data, and draft reviewer queries.
- Pre-filled PDF templates (NOC, PO, legal undertaking) are generated with `pdf-lib`.

**Document forensics (`tampering/`)**
- Detects signs of editing in PDFs and scans: PDF revision recovery, digital-signature
  validation, ELA heatmaps, noise and copy-move checks, QR consistency, and a CDSCO
  register lookup. It is detection only. See [`tampering/README.md`](tampering/README.md).

---

## Prerequisites

- **Node.js 18+** and npm
- **MongoDB** running locally (`mongodb://localhost:27017`) or a MongoDB Atlas URI
- **Mistral API key** for AI verification ([console.mistral.ai](https://console.mistral.ai/)).
  The app runs without one, but AI document checks are then unavailable.
- *(Optional, only for `tampering/`)* **Python 3.10+**, plus Tesseract OCR and `libzbar`
  for full image support

---

## Quick start (local)

Run the backend and the frontend in **two separate terminals**.

### 1. Clone

```bash
git clone https://github.com/Shivek7252/Drug-ministry.git
cd Drug-ministry
```

### 2. Backend

```bash
cd backend
npm install
```

Create `backend/.env` with the basics:

```env
MISTRAL_API_KEY=your_mistral_api_key_here
MONGODB_URI=mongodb://localhost:27017/drug_ministry
PORT=5001
```

Then generate the login accounts and session secret and append them to the same file:

```bash
node scripts/create-demo-accounts.js --demo >> .env
```

This adds `AUTH_SESSION_SECRET` and `AUTH_USERS_JSON` (scrypt hashes only) and creates
these local demo logins:

| Role | Username | Password |
| --- | --- | --- |
| Applicant | `applicant` / `applicant2` | `1234` |
| Reviewer | `reviewer` / `reviewer2` | `1234` |

> Leave out `--demo` to get random 24-character passwords instead. They are printed once,
> as comments at the end of `.env`. **Never commit `.env`.** It is already gitignored.

Start the API:

```bash
npm run dev      # auto-reload with nodemon
# or
npm start
```

Check it is up: <http://localhost:5001/health> should return JSON with `"authConfigured": true`.

### 3. Frontend

```bash
cd frontend
npm install
npm start
```

Open <http://localhost:3000>. Log in as `applicant` to apply, or as `reviewer` to land on
the review dashboard at `/review`.

If the backend is not on `localhost:5001`, set `REACT_APP_BACKEND_ORIGIN` before starting,
for example `REACT_APP_BACKEND_ORIGIN=http://localhost:5001` in `frontend/.env`.

### 4. Forensics service (optional)

```bash
cd tampering
pip install -r requirements.txt
python make_samples.py          # generate sample clean/tampered files
npm start                       # or: uvicorn app:app --port 8000
```

Opens a drag-and-drop UI at <http://localhost:8000>. CLI and API usage are in
[`tampering/README.md`](tampering/README.md).

---

## Environment variables (backend)

The full template is [`backend/.env.example`](backend/.env.example).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | `mongodb://localhost:27017/drug_ministry` | Database connection |
| `AUTH_SESSION_SECRET` | yes | – | Session signing secret (32+ chars) |
| `AUTH_USERS_JSON` | yes* | – | Login accounts (from `create-demo-accounts.js`) |
| `MISTRAL_API_KEY` | for AI | – | Mistral chat and OCR |
| `MISTRAL_TEXT_MODEL` | no | `mistral-small-latest` | Model used for verification |
| `PORT` | no | `5001` | API port |
| `FRONTEND_ORIGIN` | no | `http://localhost:3000` | Allowed CORS origin |
| `AUTH_SESSION_LIFETIME_MS` | no | `1800000` (30 min) | Session length |
| `REVIEW_SLA_DAYS` | no | – | Review SLA used in the dashboards |

\* Single accounts can also be set with `DEMO_APPLICANT_*` / `DEMO_REVIEWER_*`. Generate a
hash with `AUTH_PASSWORD=... npm run auth:hash-password`.

---

## Useful scripts

**Backend** (`cd backend`)

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Run the API |
| `npm test` | Unit tests (Node test runner) |
| `npm run test:db` | DB-backed API tests. Needs a running API plus `TEST_API_URL`, `TEST_MONGO_URL`, and `TEST_*` accounts |
| `npm run check` | Syntax-check the main server files |
| `npm run migrate:query-history` | One-time, idempotent query-history migration |
| `npm run backfill:transitions` | Backfill status-transition fields |
| `npm run auth:hash-password` | Hash a password from `AUTH_PASSWORD` |

**Frontend** (`cd frontend`)

| Command | What it does |
| --- | --- |
| `npm start` | Dev server on port 3000 |
| `npm test` | Jest and React Testing Library tests |
| `npm run build` | Production build into `frontend/build/` |
| `npm run test:e2e` | Playwright end-to-end tests (Microsoft Edge, expects the API on port 5101) |

**Forensics** (`cd tampering`): `pytest -q` runs the analyzer tests and the calibration harness.

---

## Project structure

```
Drug-ministry/
├── backend/
│   ├── server.js            # Express app: auth, AI verification, template filling
│   ├── routes/              # /api/applications (applicant + reviewer endpoints)
│   ├── models/              # Mongoose models (Application, Query, Review, Read)
│   ├── services/            # Business logic (status model, analytics, queries, storage)
│   ├── middleware/          # Session auth, CSRF, reviewer guard
│   ├── data/                # Banned drugs, countries, export categories
│   ├── templates/           # Blank PDF templates for generated documents
│   ├── scripts/             # Migrations, demo-account and test helpers
│   ├── tests/               # Backend tests
│   └── uploads/             # Uploaded files (gitignored)
├── frontend/
│   ├── src/
│   │   ├── pages/           # Dashboard, Apply, Track, Help, Contact, reviewer/*
│   │   ├── components/      # wizard/, checklist/, reconciliation/, shared/, layout/, auth/
│   │   ├── api/             # HTTP client and services
│   │   ├── hooks/           # Review queue, analytics, notifications
│   │   ├── config/          # API origin, PDF worker, filters
│   │   └── data/            # Approved, banned drugs, countries
│   └── e2e/                 # Playwright specs
├── tampering/               # Python document-forensics service (see its README)
├── documents/               # Sample application documents for manual testing
├── release-review/          # Security and release review reports, demo checklist
├── approved_drugs.xlsx      # Source list of approved drugs
└── banneddrugs.pdf          # Source list of banned drugs
```

---

## Main API endpoints

All `/api/applications` routes need a logged-in session. Write requests also need the CSRF token.

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/health` | Anyone |
| `POST` | `/api/auth/...` | Login, logout, session |
| `POST` | `/api/applications/draft`, `/submit` | Applicant |
| `GET` | `/api/applications`, `/search`, `/stats/summary` | Applicant |
| `GET` | `/api/applications/reviewer`, `/reviewer/analytics`, `/reviewer/export` | Reviewer |
| `POST` | `/api/applications/:id/review`, `PATCH /:id/status` | Reviewer |
| `POST` | `/api/applications/:appNum/pre-verify` | Reviewer (AI check of all documents) |
| `POST` | `/api/verify`, `/api/extract-doc-data`, `/api/validate-template` | AI document checks |
| `POST` | `/api/fill-templates`, `/api/fill-template/:name` | Generate pre-filled PDFs |
| `GET` | `/api/approved-drugs`, `/api/banned-drugs` | Reference data |

---

## Contributing

Each team member works on their own branch (`nitish`, `nishant`, `prateek`, `shivek`, …)
and merges into `main` once their work is tested.

```bash
git checkout <your-branch>
git pull origin main             # stay up to date with main
# ...make changes, then run tests...
git add <files>
git commit -m "short description of the change"
git push origin <your-branch>
```

Please do not commit `.env` files, `node_modules/`, `uploads/`, build output, browser
profiles, or `__pycache__/`. `.gitignore` already covers all of these.
