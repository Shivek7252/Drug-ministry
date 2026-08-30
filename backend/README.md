# Drug Ministry Backend — Document Verification API

## Setup

```bash
cd backend
npm install
```

## Configure API Key

Edit `backend/.env`:
```
MISTRAL_API_KEY=your_actual_mistral_api_key_here
PORT=5001
```

Get your key at: https://console.mistral.ai/

## Run

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Server runs at: http://localhost:5001

## Reviewer query-history migration

After deploying the reviewer query-history schema, run the idempotent backfill once:

```bash
npm run migrate:query-history
```

It creates the unique query indexes, preserves legacy reviewer/checklist/shipment
queries, recalculates query counts, and backfills approval/rejection dates.

Reviewer APIs include the paginated `GET /api/applications/reviewer`, filter
options, unpaginated CSV export, and `GET /api/applications/:id/query-history`.
They use the current frontend session convention: `X-User-Role: reviewer` and
`X-Reviewer-Name` headers.

## Endpoints

- `GET  /health` — Health check
- `POST /api/verify` — Verify document completeness
  - Body: multipart/form-data
  - Fields: `file` (PDF), `docType` (string), `docLabel` (string)
