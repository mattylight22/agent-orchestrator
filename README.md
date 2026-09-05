# Agent Lens

Agent Lens is a unified desktop and web control center for GitHub-backed workstreams running on Paseo. Each workstream owns one GitHub branch, one isolated Paseo workspace, and a gated planner → builder → reviewer lifecycle.

The Electron application remains at the repository root. The independently deployable Next.js 16 application lives in [`webapp`](webapp), and transport-neutral contracts and lifecycle helpers live in [`packages/domain`](packages/domain).

## Applications

### Electron for macOS

The desktop application connects directly to Paseo over the Mac's existing network or Tailscale connection. GitHub, Paseo, SQLite, and credentials stay in Electron's main process; credentials use macOS-backed `safeStorage`.

```bash
npm install
npm run dev
```

The desktop data path is `agent-lens/agent-lens.sqlite`. It is intentionally separate from the former product data path and no local migration or deletion is performed.

### Next.js for Vercel

The web application uses Clerk authentication, Clerk-authenticated Supabase Row Level Security, GitHub App OAuth, Paseo's end-to-end encrypted relay, Supabase Realtime, and Vercel Workflows.

```bash
npm run dev:web
npm run build:web
```

Set Vercel's Root Directory to `webapp` and configure the variables documented in [`webapp/.env.example`](webapp/.env.example). Configure the Clerk publishable/secret keys and Supabase URL/publishable key. The Clerk secret key, Supabase secret key, GitHub client secret, and 32-byte credential encryption key must only be configured server-side. Complete the one-time Clerk/Supabase dashboard activation in [`webapp/CLERK_AUTH.md`](webapp/CLERK_AUTH.md).

The GitHub callback is:

```text
https://YOUR_APP_URL/auth/github/callback
```

Connect a web-accessible Paseo host from **Settings → Paseo hosts → Add host**. The setup wizard supports:

- **Paseo Relay** — run `paseo daemon pair` on the host and paste its complete pairing link. The pairing capability is validated and encrypted server-side and never returned to the browser.
- **Direct via Tailscale** — enter a secure `wss://…/ws` endpoint using the daemon's Tailscale `100.64.0.0/10` address, Tailscale IPv6 address, or full `.ts.net` MagicDNS name. The deployed server runtime must have tailnet routing because durable workflows validate and use this connection server-side.

Relay and Tailscale can coexist on the same logical host. Agent Lens matches them using Paseo's stable daemon ID, lets either transport be primary, and retains the other as a connection fallback.

## Database

Apply the migrations in [`supabase/migrations`](supabase/migrations) to the dedicated Supabase project before deployment. The Clerk migration preserves existing ownership UUIDs behind a private identity bridge, replaces `auth.uid()` policies with Clerk-subject-aware policies, and keeps credential tables unavailable to browser sessions.

## GitHub App permissions

- Metadata: read
- Contents: read and write
- Pull requests: read and write
- Checks: read

Install the GitHub App on every user or organization account Agent Lens should access. Repository selection is account-first and includes every installation available to the authenticated GitHub user.

## Agent defaults

- Planner: `claude/claude-fable-5`, mode `plan`, thinking `high`
- Builder: `cursor/cursor-grok-4.5-high`
- Reviewer: `codex/gpt-5.6-sol`, mode `auto-review`, thinking `high`

Each launch refreshes and validates the selected host's live catalog. Missing provider/model values block the action, and `high` is only sent when the model exposes it.

## Verification

```bash
npm run typecheck
npm run typecheck:web
npm test
npm run build
npm run build:web
```

Agent Lens creates branches, Paseo projects/workspaces, agents, commits through the builder, pull requests, and independent review loops. It does not merge pull requests, delete GitHub branches, configure remote machines, manage Tailscale, or deliver application updates.
