# NeMo imap Toolkit: Plan

A tool that watches IMAP mailboxes and permanently deletes emails that match your filters. Runs on a VPS, managed from a web panel.

## What it does

1. Add IMAP accounts (email + password / IMAP credentials). OAuth later.
2. It stays connected to each account and checks every new email as it arrives.
3. If an email matches a filter, it is permanently deleted automatically.
4. Every deletion is logged.

That is all it does.

## Filters

Each filter has a name, an on/off switch, and one or more conditions (combined with AND / OR).

Match on:
- Sender email
- Sender domain
- Subject (title)
- Body text
- Sender name
- Any header

Match type: equals, contains, starts with, ends with, regex.

A condition can hold many values at once (one per line), so you can block many domains or emails in a single filter.

## Panel

Clean, minimal, dark, developer-style UI. Four pages:

- **Accounts:** add, edit, remove, on/off, live status (connected / error).
- **Filters:** create, edit, on/off, delete.
- **Logs:** every deleted email (time, account, sender, subject, which filter matched) with search.
- **Dashboard:** deleted today / this week / total, and account status.

Login is one admin password set in the env file.

## Stack

TypeScript. Node.js + Fastify, `imapflow` for IMAP, SQLite for storage. React + Vite + Tailwind + shadcn/ui for the panel. Docker + Caddy for deployment.

## How it works

- One connection per account using IMAP IDLE, so new mail is caught instantly. It reconnects automatically if the connection drops.
- Only mail that arrives after you add an account is checked. Existing mail is left alone.
- On a match it deletes permanently (mark deleted + expunge, and on Gmail also clear it from Trash), then writes the log entry.
- Mailbox passwords are stored encrypted.

## Build order

1. Project setup, database, password encryption
2. Filter matching logic (with tests)
3. IMAP watcher + permanent delete + logging
4. API + admin login
5. Panel UI
6. Docker deployment
7. OAuth (Google, Microsoft)