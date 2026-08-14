-- Run against a disposable local Supabase/Postgres database after applying migrations.
-- The transaction is rolled back, so no test users or notebook data remain.
begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

do $$
declare
  workspace jsonb;
  sharing jsonb;
begin
  workspace := public.load_workspace();
  if jsonb_array_length(workspace -> 'notebooks') <> 0 then
    raise exception 'Expected an empty first-user workspace';
  end if;

  perform public.save_notebook_snapshot('{
    "id":"notebook-a","title":"RLS notebook","emoji":"📓",
    "sources":[{"id":"source-a","title":"Evidence","kind":"text","origin":"test","content":"Grounded evidence.","summary":"","topics":[],"selected":true,"createdAt":1700000000000}],
    "messages":[{"id":"message-a","role":"user","content":"Question","citations":[],"createdAt":1700000000001}],
    "artifacts":[],
    "notes":[{"id":"note-a","title":"Note","body":"Body","createdAt":1700000000002}],
    "chatConfig":{"style":"Default","length":"Default","instructions":""},
    "createdAt":1700000000000,"updatedAt":1700000000000
  }'::jsonb);

  -- Later UI snapshots omit unchanged source bodies to keep requests small.
  perform public.save_notebook_snapshot('{
    "id":"notebook-a","title":"RLS notebook updated","emoji":"📓",
    "sources":[{"id":"source-a","title":"Evidence","kind":"text","origin":"test","summary":"","topics":[],"selected":true,"createdAt":1700000000000}],
    "messages":[{"id":"message-a","role":"user","content":"Question","citations":[],"createdAt":1700000000001}],
    "artifacts":[],
    "notes":[{"id":"note-a","title":"Note","body":"Body","createdAt":1700000000002}],
    "chatConfig":{"style":"Default","length":"Default","instructions":""},
    "createdAt":1700000000000,"updatedAt":1700000000003
  }'::jsonb);

  if (select content from public.sources where id = 'source-a') <> 'Grounded evidence.' then
    raise exception 'Compact snapshot lost unchanged source content';
  end if;

  if jsonb_array_length(public.load_ai_sources('notebook-a', array['source-a'])) <> 1 then
    raise exception 'AI source RPC did not return the owned source';
  end if;

  sharing := public.set_notebook_sharing('notebook-a', 'full');
  if sharing ->> 'access' <> 'full' or sharing ->> 'token' is null then
    raise exception 'Full-notebook sharing did not create a token';
  end if;
  perform set_config('test.share_token', sharing ->> 'token', true);

  workspace := public.load_workspace();
  if jsonb_array_length(workspace -> 'notebooks') <> 1
    or jsonb_array_length(workspace #> '{notebooks,0,sources}') <> 1
    or jsonb_array_length(workspace #> '{notebooks,0,messages}') <> 1
    or jsonb_array_length(workspace #> '{notebooks,0,notes}') <> 1 then
    raise exception 'Snapshot round-trip failed';
  end if;
end;
$$;

reset role;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';
set local role authenticated;

do $$
declare
  workspace jsonb;
  shared_workspace jsonb;
  share_token uuid := current_setting('test.share_token')::uuid;
  visible_rows integer;
begin
  workspace := public.load_workspace();
  select count(*) into visible_rows from public.notebooks;
  if jsonb_array_length(workspace -> 'notebooks') <> 0
    or visible_rows <> 0
    or jsonb_array_length(public.load_ai_sources('notebook-a', array['source-a'])) <> 0 then
    raise exception 'RLS exposed another user workspace';
  end if;

  shared_workspace := public.load_shared_notebook(share_token);
  if shared_workspace ->> 'access' <> 'full'
    or shared_workspace #>> '{notebook,title}' <> 'RLS notebook updated'
    or shared_workspace #>> '{notebook,sources,0,content}' <> 'Grounded evidence.'
    or jsonb_array_length(shared_workspace #> '{notebook,messages}') <> 0
    or jsonb_array_length(shared_workspace #> '{notebook,notes}') <> 1 then
    raise exception 'Token-bound full sharing returned an invalid snapshot';
  end if;
  if jsonb_array_length(public.load_shared_ai_sources(share_token, 'notebook-a', array['source-a'])) <> 1 then
    raise exception 'Shared chat could not load token-bound source evidence';
  end if;
  if public.load_shared_notebook('33333333-3333-4333-8333-333333333333') is not null
    or jsonb_array_length(public.load_shared_ai_sources('33333333-3333-4333-8333-333333333333', 'notebook-a', array['source-a'])) <> 0 then
    raise exception 'An invalid share token returned notebook data';
  end if;
  perform public.clear_workspace();
end;
$$;

reset role;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

do $$
declare
  shared_workspace jsonb;
  share_token uuid := current_setting('test.share_token')::uuid;
begin
  if jsonb_array_length(public.load_workspace() -> 'notebooks') <> 1 then
    raise exception 'Second user clear affected the first user';
  end if;

  update public.sources set selected = false where id = 'source-a';
  perform public.set_notebook_sharing('notebook-a', 'chat');
  shared_workspace := public.load_shared_notebook(share_token);
  if shared_workspace ->> 'access' <> 'chat'
    or shared_workspace #>> '{notebook,sources,0,content}' <> ''
    or shared_workspace #>> '{notebook,sources,0,selected}' <> 'true'
    or jsonb_array_length(shared_workspace #> '{notebook,artifacts}') <> 0
    or jsonb_array_length(shared_workspace #> '{notebook,notes}') <> 0 then
    raise exception 'Chat-only sharing exposed full notebook materials';
  end if;

  perform public.set_notebook_sharing('notebook-a', 'private');
  if public.load_shared_notebook(share_token) is not null
    or jsonb_array_length(public.load_shared_ai_sources(share_token, 'notebook-a', array['source-a'])) <> 0 then
    raise exception 'Revoked share token still returned notebook data';
  end if;
  perform public.clear_workspace();
  if jsonb_array_length(public.load_workspace() -> 'notebooks') <> 0 then
    raise exception 'Workspace clear failed';
  end if;
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.notebooks', 'select')
    or has_function_privilege('anon', 'public.load_workspace()', 'execute')
    or has_function_privilege('anon', 'public.load_ai_sources(text,text[])', 'execute')
    or has_function_privilege('anon', 'public.load_shared_notebook(uuid)', 'execute')
    or has_function_privilege('anon', 'private.load_shared_notebook(uuid)', 'execute')
    or has_schema_privilege('anon', 'private', 'usage') then
    raise exception 'The anon Postgres role received workspace access';
  end if;
  if not has_function_privilege('authenticated', 'public.load_workspace()', 'execute')
    or not has_function_privilege('authenticated', 'public.load_ai_sources(text,text[])', 'execute')
    or not has_function_privilege('authenticated', 'public.set_notebook_sharing(text,text)', 'execute')
    or not has_function_privilege('authenticated', 'public.load_shared_notebook(uuid)', 'execute')
    or not has_function_privilege('authenticated', 'public.load_shared_ai_sources(uuid,text,text[])', 'execute') then
    raise exception 'Authenticated RPC grants are missing';
  end if;
end;
$$;

rollback;
