# Launchpad

A small, fictional project-management app: sign in, name a workspace, pick a
workflow, and get a four-stage board (Brief, Build, Review, Handoff) with sample
tasks. You can add tasks and move them between stages, and everything is saved
per account in a local SQLite database.

It is built with Next.js, React, Clerk sign-in, and Node's built-in SQLite. There
are no real invitations, payments, uploads, or customer data.

This is the **starter** for the Synthesia Interactive Avatars build video. It is
the app on its own, with no AI guide. In the video, an onboarding guide is added
on top of this app with a coding agent, Synthesia's skill and quickstart, and
LiveKit. The app's own product docs, which that guide answers from, are already
here in [`docs/product`](docs/product).

## Run it

You need Node 24 or newer and a free [Clerk](https://clerk.com) application.

1. Install dependencies.

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and add your Clerk **development**
   publishable key and secret key from the Clerk dashboard (API keys page).

   ```sh
   cp .env.example .env.local
   ```

3. Check your configuration, then start the app.

   ```sh
   npm run preflight
   npm run dev
   ```

4. Open <http://127.0.0.1:3212> (use this exact address; sign-in and the API
   only accept requests from it). Create an account, set up your workspace, and
   you land on the board.

The database lives in `.data/launchpad.sqlite`, which is git-ignored. Each
signed-in account has its own isolated workspace. To start over, open
**Reset demo workspace** at the bottom of the board and type `RESET`.

## What's in here

| Path | What it is |
| --- | --- |
| `src/app` | Pages (landing, sign-in, onboarding, dashboard) and API routes |
| `src/app/api` | `workspace` (create/read), `tasks` (add), `tasks/stage` (move), `reset` |
| `src/components` | Onboarding form, board/list views, New task form, Move task panel |
| `src/lib/store.ts` | SQLite store; every read and write is scoped to the signed-in user |
| `src/lib/contracts.ts` | Shared input validation (zod) |
| `docs/product` | Six short product docs describing how Launchpad works |
| `DESIGN.md` | Visual design notes |

Adding and moving tasks are idempotent: each save carries a request ID, so a
retry after a lost response never creates a duplicate or repeats a move.

## Checks

```sh
npm run typecheck
npm test
npm run build
node scripts/check-client-secrets.mjs   # after a build: no server secret in browser assets
```

Browser checks are described in [`e2e/README.md`](e2e/README.md).
