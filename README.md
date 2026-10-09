# Launchpad

A small, fictional project-management app: sign in, name a workspace, pick a
workflow, and get a four-stage board (Brief, Build, Review, Handoff) with sample
tasks. You can add tasks and move them between stages, and everything is saved
per account in a local SQLite database.

It is built with Next.js, React, Clerk sign-in, and Node's built-in SQLite. There
are no real invitations, payments, uploads, or customer data.

This is the **starter** for the Synthesia Interactive Avatars build video. It is
the app on its own, with no AI guide. Part 1 gets it running. Part 2 walks through
adding the onboarding guide with a coding agent, Synthesia's skill and quickstart,
and LiveKit. The product docs that the guide answers from are already here in
[`docs/product`](docs/product).

## Part 1. Run the app

You need [Node 24](https://nodejs.org) or newer and a free [Clerk](https://clerk.com) account.

1. Clone and install.

   ```sh
   git clone https://github.com/sonnysangha/launchpad-starter.git
   cd launchpad-starter
   npm ci
   ```

2. Get your Clerk keys. In the [Clerk dashboard](https://dashboard.clerk.com), create an application, open **API keys**, and copy the publishable key and secret key. Use the **development** keys.

3. Copy `.env.example` to `.env.local` and paste the two keys in.

   ```sh
   cp .env.example .env.local
   ```

4. Check your configuration, then start the app.

   ```sh
   npm run preflight
   npm run dev
   ```

5. Open <http://127.0.0.1:3212>. Use this exact address, because sign-in and the API only accept requests from it. Create an account and set up your workspace, and you land on the board.

The database lives in `.data/launchpad.sqlite`, which is git-ignored. Each signed-in account has its own isolated workspace. To start over, open **Reset demo workspace** at the bottom of the board and type `RESET`.

## Part 2. Add the AI onboarding guide

This is the build from the video. A coding agent adds a talking Synthesia avatar that guides new users, clicks the real buttons, answers from the product docs, and adds and moves tasks.

### What you need

- A coding agent that supports skills, such as Codex or Claude Code
- [Python](https://www.python.org/downloads/) 3.12 or newer (the video used 3.13)
- A microphone, and Chrome or another modern browser

### 1. Install the skills

Run these in the project folder. They give your coding agent the official Synthesia and LiveKit instructions, so it reads the real docs instead of guessing.

```sh
npx skills add synthesia-ai/skills
npx skills add livekit/agent-skills
```

Sources: Synthesia's [Interactive Avatars page](https://www.synthesia.io/features/avatars/interactive-avatars) ("Let your coding agent handle integration") and LiveKit's [Agent Skills docs](https://docs.livekit.io/reference/developer-tools/agent-skills/).

### 2. Get your keys

| Key | Where to get it |
| --- | --- |
| LiveKit URL, API key, API secret | Create a free project on [LiveKit Cloud](https://cloud.livekit.io). It also runs Cartesia for speech, so you don't need a separate Cartesia key. |
| Synthesia API key | [Create your API key](https://docs.synthesia.io/reference/synthesia-api-quickstart#create-your-api-key). Your plan needs Interactive Avatars. |
| Synthesia avatar ID | In [Synthesia Studio](https://app.synthesia.io), open an avatar's ••• menu and choose **Copy Interactive ID**. Stock actor avatars such as Ryan or Ada don't work. |
| OpenAI API key | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

Your coding agent will tell you which file each key goes in. Keep them in git-ignored env files, and never put a server secret in a `NEXT_PUBLIC_` variable.

### 3. Give your coding agent these prompts, in order

The starting point is Synthesia's [minimal quickstart](https://docs.synthesia.io/reference/interactive-avatar-minimal-quickstart): a Python LiveKit agent with an avatar attached.

1. > Use the synthesia-interactive-avatar skill, the LiveKit agent skills and Synthesia's minimal quickstart to add an onboarding guide to this app. Put the Python agent in its own agent folder, show the guide in a bottom-right widget, and give it a male voice.
2. > When I ask to see part of the app, have the guide click the real buttons to show me.
3. > Teach the guide how Launchpad works using the docs in the docs/product folder. It should only answer from those docs, say so when it doesn't know, and show which doc each answer came from.
4. > Let the guide add tasks and move them between stages when I ask, using the New task and Move task buttons. It should only say it's done after the save succeeds.

Review what it builds after each prompt, and run the app before moving on. Your result won't match the video line for line, which is normal for a coding agent.

Want to compare with the finished version from the video? It's at [launchpad-ai-guide](https://github.com/sonnysangha/launchpad-ai-guide).

### 4. Run it

The Python agent is a separate worker that sits next to the app. The app gives your browser a LiveKit room, and the worker joins the same room and brings the avatar with it. Use two terminals:

```sh
npm run dev                  # the app
python agent/agent.py dev    # the guide (run inside the virtual environment your coding agent set up)
```

Open the board, start a conversation with the guide, and wait for its greeting. Then try:

- "I just signed up and I'm a bit lost. Where do I start?"
- Interrupt it: "Wait, show me Review."
- "What happens next?"
- "Add a task called Design homepage."
- "Move Design homepage to Build."

Refresh afterwards, and the tasks are still there.

Every conversation uses your LiveKit, Synthesia and OpenAI usage, so end the conversation when you're done.

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
