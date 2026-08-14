begin;

alter table public.notebooks
  add column sharing_access text not null default 'private',
  add column share_token uuid,
  add constraint notebooks_sharing_access_check
    check (sharing_access in ('private', 'full', 'chat')),
  add constraint notebooks_sharing_token_check
    check (
      (sharing_access = 'private' and share_token is null)
      or (sharing_access in ('full', 'chat') and share_token is not null)
    );

create unique index notebooks_share_token_idx
  on public.notebooks (share_token)
  where share_token is not null;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function public.set_notebook_sharing(
  requested_notebook_id text,
  requested_access text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if requested_access not in ('private', 'full', 'chat') then
    raise exception 'Sharing access must be private, full, or chat' using errcode = '22023';
  end if;

  update public.notebooks
  set
    sharing_access = requested_access,
    share_token = case
      when requested_access = 'private' then null
      else coalesce(share_token, gen_random_uuid())
    end
  where user_id = current_user_id and id = requested_notebook_id
  returning jsonb_build_object(
    'access', sharing_access,
    'token', share_token
  ) into result;

  if result is null then
    raise exception 'Notebook not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function private.load_shared_notebook(requested_share_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  shared_notebook public.notebooks%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if requested_share_token is null then
    return null;
  end if;

  select notebook.* into shared_notebook
  from public.notebooks notebook
  where notebook.share_token = requested_share_token
    and notebook.sharing_access in ('full', 'chat');

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'access', shared_notebook.sharing_access,
    'notebook', jsonb_build_object(
      'id', shared_notebook.id,
      'title', shared_notebook.title,
      'emoji', shared_notebook.emoji,
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', source.id,
          'title', source.title,
          'kind', source.kind,
          'origin', case when shared_notebook.sharing_access = 'full' then source.origin else '' end,
          'content', case when shared_notebook.sharing_access = 'full' then source.content else '' end,
          'summary', case when shared_notebook.sharing_access = 'full' then source.summary else '' end,
          'topics', case when shared_notebook.sharing_access = 'full' then to_jsonb(source.topics) else '[]'::jsonb end,
          'selected', case when shared_notebook.sharing_access = 'chat' then true else source.selected end,
          'createdAt', floor(extract(epoch from source.created_at) * 1000)
        ) order by source.created_at)
        from public.sources source
        where source.user_id = shared_notebook.user_id
          and source.notebook_id = shared_notebook.id
      ), '[]'::jsonb),
      'messages', '[]'::jsonb,
      'artifacts', case when shared_notebook.sharing_access = 'full' then coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', artifact.id,
          'type', artifact.type,
          'title', artifact.title,
          'status', artifact.status,
          'config', artifact.config,
          'content', artifact.content,
          'error', artifact.error,
          'model', artifact.model,
          'createdAt', floor(extract(epoch from artifact.created_at) * 1000)
        )) order by artifact.created_at)
        from public.artifacts artifact
        where artifact.user_id = shared_notebook.user_id
          and artifact.notebook_id = shared_notebook.id
      ), '[]'::jsonb) else '[]'::jsonb end,
      'notes', case when shared_notebook.sharing_access = 'full' then coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', note.id,
          'title', note.title,
          'body', note.body,
          'locked', true,
          'createdAt', floor(extract(epoch from note.created_at) * 1000)
        )) order by note.created_at)
        from public.notes note
        where note.user_id = shared_notebook.user_id
          and note.notebook_id = shared_notebook.id
      ), '[]'::jsonb) else '[]'::jsonb end,
      'chatConfig', jsonb_build_object(
        'style', shared_notebook.chat_style,
        'length', shared_notebook.chat_length,
        'instructions', shared_notebook.chat_instructions
      ),
      'createdAt', floor(extract(epoch from shared_notebook.created_at) * 1000),
      'updatedAt', floor(extract(epoch from shared_notebook.updated_at) * 1000)
    )
  );
end;
$$;

create or replace function private.load_shared_ai_sources(
  requested_share_token uuid,
  requested_notebook_id text,
  requested_source_ids text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if requested_share_token is null or requested_notebook_id is null or requested_notebook_id = '' then
    return '[]'::jsonb;
  end if;
  if requested_source_ids is null or cardinality(requested_source_ids) < 1 or cardinality(requested_source_ids) > 100 then
    raise exception 'Between 1 and 100 source ids are required' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', source.id,
      'title', source.title,
      'kind', source.kind,
      'origin', source.origin,
      'content', source.content,
      'summary', source.summary,
      'topics', to_jsonb(source.topics),
      'selected', source.selected,
      'created_at', source.created_at
    ) order by source.created_at)
    from public.notebooks notebook
    join public.sources source
      on source.user_id = notebook.user_id and source.notebook_id = notebook.id
    where notebook.share_token = requested_share_token
      and notebook.id = requested_notebook_id
      and notebook.sharing_access in ('full', 'chat')
      and source.id = any(requested_source_ids)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.load_shared_notebook(requested_share_token uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as 'select private.load_shared_notebook(requested_share_token)';

create or replace function public.load_shared_ai_sources(
  requested_share_token uuid,
  requested_notebook_id text,
  requested_source_ids text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as 'select private.load_shared_ai_sources(requested_share_token, requested_notebook_id, requested_source_ids)';

revoke execute on function public.set_notebook_sharing(text, text) from public, anon;
revoke execute on function public.load_shared_notebook(uuid) from public, anon;
revoke execute on function public.load_shared_ai_sources(uuid, text, text[]) from public, anon;
revoke execute on function private.load_shared_notebook(uuid) from public, anon;
revoke execute on function private.load_shared_ai_sources(uuid, text, text[]) from public, anon;

grant execute on function public.set_notebook_sharing(text, text) to authenticated;
grant execute on function public.load_shared_notebook(uuid) to authenticated;
grant execute on function public.load_shared_ai_sources(uuid, text, text[]) to authenticated;
grant execute on function private.load_shared_notebook(uuid) to authenticated;
grant execute on function private.load_shared_ai_sources(uuid, text, text[]) to authenticated;

commit;
