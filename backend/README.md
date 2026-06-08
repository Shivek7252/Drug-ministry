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

## Endpoints

- `GET  /health` — Health check
- `POST /api/verify` — Verify document completeness
  - Body: multipart/form-data
  - Fields: `file` (PDF), `docType` (string), `docLabel` (string)
