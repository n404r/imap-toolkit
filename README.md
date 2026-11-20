# IMAP Toolkit

> Watch IMAP mailboxes and permanently delete emails that match your filters. Runs on a VPS, managed from a web panel.

## Quick start

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Web panel login password (min 8 chars) |
| `JWT_SECRET` | Random 32+ char string for session tokens |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for encrypting IMAP passwords |

Generate secrets on Linux/Mac:
```bash
openssl rand -hex 32   # for JWT_SECRET
openssl rand -hex 32   # for ENCRYPTION_KEY
```

### 2. Run with Docker (recommended)

Edit `Caddyfile` to set your domain, then:

```bash
docker compose up -d
```

The panel will be live at `https://your-domain.com`.

### 3. Run locally (dev)

```bash
npm install
npm run dev        # starts Fastify on :3000

# In another terminal:
cd src/client && npx vite   # starts Vite dev server on :5173
```

## Stack

- **Backend**: Node.js + Fastify + TypeScript + imapflow
- **Database**: SQLite (better-sqlite3) with WAL mode
- **Frontend**: React + Vite + Tailwind CSS (dark, dev-style)
- **Deployment**: Docker + Caddy (auto-TLS)

## Build order (implemented)

- [x] 1. Project setup, database, password encryption (AES-256-GCM)
- [x] 2. Filter matching engine + tests (Vitest)
- [x] 3. IMAP watcher (imapflow IDLE) + permanent delete + logging
- [x] 4. API + admin login (JWT cookie)
- [x] 5. Panel UI (React, 4 pages: Dashboard / Accounts / Filters / Logs)
- [x] 6. Docker + Caddy deployment
- [ ] 7. OAuth (Google, Microsoft) — future

## Running tests

```bash
npm test
```
