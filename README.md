# NotebookLM Clone

A source-grounded NotebookLM-style interview project built with React, Vite, Supabase, and Groq. Notebooks, sources, chat history, Studio artifacts, notes, and preferences live in Postgres; the browser no longer uses application `localStorage` or an Express server.

## Product surface

- Searchable notebook library with recency/title sorting, grid/list views, safe notebook copies, and a responsive three-panel workspace
- PDF, DOCX, text, website, YouTube transcript, image OCR, and audio imports
- Searchable source selection with automatic topic labels from five sources onward, collapsible groups, manual label management, source details, grounded chat, citation hover previews with exact-passage navigation, and chat configuration
- Fast Research plus multi-step Deep Research reports with tool-backed, review-before-import web sources
- Audio/video overviews, mind maps, reports, flashcards, quizzes, infographics, slides, and data tables with inspectable generation prompts and Markdown/CSV exports
- Notes, saved answers, export, light/dark/system theme, and English/German output
- Guest workspaces, data-preserving account upgrades, email/password sign-in, password recovery, and local sign-out
- Revocable public links with full-notebook or chat-only access
- Loading, retry, generation, empty, provider-limit, import, and persistence-error states

## Architecture

```text
React/Vite browser
  ├─ Supabase anonymous Auth session
  ├─ Postgres RPCs + RLS for notebook persistence
  ├─ notebook-ai Edge Function ── Groq chat, discovery, speech
  ├─ source-import Edge Function ── extraction, SSRF checks, OCR/transcription
  └─ send-email Edge Function ── Send Email Auth hook, branded templates, Resend delivery
```

The Groq and Resend keys exist only as Edge Function secrets. Every table has Row Level Security and every policy scopes rows to `(select auth.uid())`. The browser sends only notebook/source IDs for chat and artifact generation; the Edge Function reloads those sources through an authenticated RPC that forwards the caller JWT and therefore remains subject to RLS.

Public notebooks do not weaken those owner policies. A UUID share token is checked by narrow RPCs: full access returns a read-only notebook without the owner's chat history, while chat-only access redacts source text and Studio content from the browser. Grounded shared chat loads source text server-side through a separate token-bound RPC. Turning sharing off invalidates the link, and turning it on again creates a new token.

The snapshot RPC performs each notebook update in one database transaction. `load_workspace()` returns one nested JSON document so a workspace does not silently stop at PostgREST's default row limit.

## Authentication model

The app opens immediately with an anonymous Supabase user. Choosing **Create account** links a verified email to that same user ID before a password is set, so existing notebooks keep their RLS owner and do not need to be copied. Signing in to a different existing account is intentionally separate and requires an explicit warning acknowledgment when the guest workspace contains notebooks.

Hosted Auth configuration must keep anonymous sign-ins and manual identity linking enabled. Before deploying the frontend, add its exact production and preview URLs to `additional_redirect_urls`; confirmation and recovery links return to the application with an `account` action parameter.

Supabase Auth never sends mail itself. The [Send Email hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) posts every account and security event to the `send-email` Edge Function, which verifies the Standard Webhooks signature, renders the NotebookLM-styled template for that action, and hands the message to Resend. Confirmation, invite, magic-link, recovery, reauthentication, email-change, and the four security notifications are covered; a secure email change sends the current and the new address their own token pair, and a guest upgrade only mails the new address. Resend outages are answered with `503` and `Retry-After` so Auth retries instead of losing the email.

## Supabase setup

Prerequisites: Node.js 22+, Deno 2+, Supabase CLI, and a Supabase project.

1. Link this folder to the intended project (do not use an unrelated project):

   ```powershell
   supabase.exe link --project-ref YOUR_PROJECT_REF
   ```

2. Verify a sending domain in Resend, create a Resend API key, and open **Authentication > Hooks > Send Email** in the Supabase dashboard to generate the hook secret. Store all three as Function secrets:

   ```powershell
   supabase.exe secrets set RESEND_API_KEY=re_xxx "RESEND_FROM_ADDRESS=NotebookLM Clone <auth@your-domain>" "SEND_EMAIL_HOOK_SECRET=v1,whsec_xxx"
   ```

   `SEND_EMAIL_HOOK_SECRET` must hold the same value on both sides: Auth signs the payload with it and the Function verifies the signature with it.

3. Deploy the Edge Functions:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-supabase-ai.ps1
   supabase.exe functions deploy notebook-ai source-import send-email --use-api
   ```

   The script prompts for the Groq key securely and never writes it to a repository file or shell history. Hosted Supabase Secrets are the source of truth for Function configuration.

4. Push the hosted Auth configuration, including anonymous sign-ins, manual email linking, redirect URLs, the 8-character password minimum, and the Send Email hook. The hook URI differs per environment, so `config push` reads it from the root `.env`:

   ```powershell
   supabase.exe config push --yes
   ```

   Because the hook replaces Supabase's own mail provider, the Free-plan template restriction for projects created after June 3, 2026 no longer applies, and no SMTP server has to be configured.

5. Apply the migration:

   ```powershell
   supabase.exe db push
   ```

6. Create root `.env` from `.env.example`. Besides the public project URL and publishable key required by Vite, it holds the two values the Supabase CLI substitutes into `config.toml`. Never put a service-role key, Groq key, or Resend key in a `VITE_` variable.

   ```ini
   SEND_EMAIL_HOOK_URI=https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-email
   SEND_EMAIL_HOOK_SECRET=v1,whsec_xxx
   ```

   For the local stack, point `SEND_EMAIL_HOOK_URI` at `http://host.docker.internal:54321/functions/v1/send-email` and put `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, and `SEND_EMAIL_HOOK_SECRET` in `supabase/functions/.env`.

7. Install and run:

   ```powershell
   npm install
   npm run dev
   ```

Open `http://localhost:5173`.

For a fully local Supabase stack, Docker Desktop must be running before `supabase start`. This project can otherwise use hosted Supabase during frontend development.

## Verification

```powershell
npm test
npm run test:functions
npm run test:database
npm run lint
npm run check:functions
npm run check:function-sizes
npm run build
npm audit
npm run verify:supabase
```

Test code is kept out of production modules:

```text
tests/
  frontend/       # Vitest component and repository tests
  functions/      # Deno unit and integration tests for Edge Functions
  database/       # Disposable PostgreSQL migration and RLS smoke tests
  deployment/     # Hosted Supabase end-to-end verification
```

`verify:supabase` creates two anonymous sessions, writes a temporary labeled notebook and settings, proves label/save/load round-trips, full-share and chat-only redaction, and cross-user RLS isolation, invokes Deep Research, grounded Groq chat, Studio artifact generation, and source import, then clears the temporary workspace in a `finally` block. It requires a valid deployed Groq key. The function-size gate keeps both dependency graphs below the 5 MB server-side bundling threshold, so deployment does not depend on local Docker.

On Windows, `test:database` expects PostgreSQL 18 in `C:\Program Files\PostgreSQL\18\bin`. It starts a disposable native cluster, applies the migration and security smoke tests, then removes the cluster again.

## Database and security

The migration in `supabase/migrations` creates:

- `user_settings`
- `notebooks`
- `sources`
- `chat_messages`
- `artifacts`
- `notes`
- `save_notebook_snapshot(jsonb)`, `load_workspace()`, `load_ai_sources(text, text[])`, token-bound shared-read functions, and `clear_workspace()`

All tables have explicit grants, authenticated-only RLS policies, composite ownership keys, cascade cleanup, constraints, and indexes for notebook-scoped reads. RPC execution is revoked from `public` and `anon` and granted only to `authenticated` and `service_role`. Shared-read helpers are `SECURITY DEFINER` functions in a non-exposed `private` schema with an empty `search_path`; public wrappers remain invoker-safe.

Source URL imports allow only public HTTP(S) destinations, reject local/private DNS results and every redirect target, cap downloads, and strip non-content HTML. Source text is always treated as untrusted data inside AI prompts.
