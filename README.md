# NotebookLM Clone

A source-grounded NotebookLM-style interview project built with React, Vite, Supabase, and Groq. Notebooks, sources, chat history, Studio artifacts, notes, and preferences live in Postgres; the browser no longer uses application `localStorage` or an Express server.

## Product surface

- Notebook library with responsive three-panel notebook workspace
- PDF, DOCX, text, website, YouTube transcript, image OCR, and audio imports
- Source selection, source details, grounded chat, exact-excerpt citations, and chat configuration
- Live-web source discovery with review-before-import
- Audio/video overviews, mind maps, reports, flashcards, quizzes, infographics, slides, and data tables
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
  └─ source-import Edge Function ── extraction, SSRF checks, OCR/transcription
```

The Groq key exists only as an Edge Function secret. Every table has Row Level Security and every policy scopes rows to `(select auth.uid())`. The browser sends only notebook/source IDs for chat and artifact generation; the Edge Function reloads those sources through an authenticated RPC that forwards the caller JWT and therefore remains subject to RLS.

Public notebooks do not weaken those owner policies. A UUID share token is checked by narrow RPCs: full access returns a read-only notebook without the owner's chat history, while chat-only access redacts source text and Studio content from the browser. Grounded shared chat loads source text server-side through a separate token-bound RPC. Turning sharing off invalidates the link, and turning it on again creates a new token.

The snapshot RPC performs each notebook update in one database transaction. `load_workspace()` returns one nested JSON document so a workspace does not silently stop at PostgREST's default row limit.

## Authentication model

The app opens immediately with an anonymous Supabase user. Choosing **Create account** links a verified email to that same user ID before a password is set, so existing notebooks keep their RLS owner and do not need to be copied. Signing in to a different existing account is intentionally separate and requires an explicit warning acknowledgment when the guest workspace contains notebooks.

Hosted Auth configuration must keep anonymous sign-ins and manual identity linking enabled. Before deploying the frontend, add its exact production and preview URLs to `additional_redirect_urls`; confirmation and recovery links return to the application with an `account` action parameter.

## Supabase setup

Prerequisites: Node.js 22+, Deno 2+, Supabase CLI, and a Supabase project.

1. Link this folder to the intended project (do not use an unrelated project):

   ```powershell
   supabase.exe link --project-ref YOUR_PROJECT_REF
   ```

2. Push the hosted Auth configuration, including anonymous sign-ins, manual email linking, redirect URLs, and the 8-character password minimum:

   ```powershell
   supabase.exe config push --yes
   ```

3. Apply the migration:

   ```powershell
   supabase.exe db push
   ```

4. Store the Groq key and all model selections directly as Supabase Secrets, then deploy:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-supabase-ai.ps1
   supabase.exe functions deploy notebook-ai source-import --use-api
   ```

   The script prompts securely and never writes the key to a repository file or shell history. Hosted Supabase Secrets are the source of truth for Function configuration.

5. Create root `.env` from `.env.example`. It contains only the public project URL and publishable key required by Vite. Never put a service-role key or Groq key in a `VITE_` variable.

6. Install and run:

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

`verify:supabase` creates two anonymous sessions, writes a temporary notebook and settings, proves save/load and cross-user RLS isolation, invokes a grounded Groq chat and source import, then clears the temporary workspace in a `finally` block. It requires a valid deployed Groq key. The function-size gate keeps both dependency graphs below the 5 MB server-side bundling threshold, so deployment does not depend on local Docker.

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
