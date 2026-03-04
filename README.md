<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# CLIC-POS local setup

This project is no longer a standalone AI Studio demo. Locally it runs as a small stack:

- Web app (Vite): `http://localhost:3000`
- Local API server (Express): `http://localhost:3001`
- KDS service (Python): `http://localhost:8001`

If `http://localhost:3000` shows `ERR_CONNECTION_REFUSED`, there is no frontend process listening on that port yet.

## Prerequisites

- Node.js
- npm
- Python 3

## Install dependencies

```bash
npm install
```

## Environment

Review these files before starting the stack:

- [`.env`](.env)
- [`.env.local`](.env.local)

Set only the values you need for your environment. The current ERP/POS flow prioritizes local operation and optional integrations.

## Run locally

For the full local stack, use:

```bash
npm run start:dev
```

This starts:

- Vite on port `3000`
- The local API on port `3001`
- The KDS Python service on port `8001`

## Frontend only

If you only need the web client, use:

```bash
npm run dev
```

Vite is configured with `strictPort: true`, so it will fail instead of silently changing ports when `3000` is already in use.

## Helpful checks

- Verify the frontend is listening:

```bash
curl -I http://127.0.0.1:3000
```

- Verify the API is listening:

```bash
curl http://127.0.0.1:3001/api/status
```

## Other scripts

```bash
npm run build
npm run lint
npm run preview
npm run start:mobile
```
