begin;

alter table public.sources
  add column label text not null default '',
  add constraint sources_label_length_check check (char_length(label) <= 80);

-- The snapshot function is recreated in full because the sources insert now carries label.
create or replace function public.save_notebook_snapshot(snapshot jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_notebook_id text := snapshot ->> 'id';
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if current_notebook_id is null or current_notebook_id = '' then
    raise exception 'Notebook id is required' using errcode = '22023';
  end if;

  insert into public.notebooks (
    user_id, id, title, emoji, chat_style, chat_length, chat_instructions, created_at, updated_at
  ) values (
    current_user_id,
    current_notebook_id,
    snapshot ->> 'title',
    coalesce(snapshot ->> 'emoji', '📓'),
    coalesce(snapshot #>> '{chatConfig,style}', 'Default'),
    coalesce(snapshot #>> '{chatConfig,length}', 'Default'),
    coalesce(snapshot #>> '{chatConfig,instructions}', ''),
    to_timestamp((snapshot ->> 'createdAt')::double precision / 1000.0),
    now()
  )
  on conflict (user_id, id) do update set
    title = excluded.title,
    emoji = excluded.emoji,
    chat_style = excluded.chat_style,
    chat_length = excluded.chat_length,
    chat_instructions = excluded.chat_instructions,
    updated_at = excluded.updated_at;

  insert into public.sources (
    user_id, id, notebook_id, title, kind, origin, content, summary, topics, label, selected, created_at
  )
  select
    current_user_id,
    item ->> 'id',
    current_notebook_id,
    item ->> 'title',
    item ->> 'kind',
    coalesce(item ->> 'origin', ''),
    coalesce(
      item ->> 'content',
      (
        select existing.content
        from public.sources existing
        where existing.user_id = current_user_id and existing.id = item ->> 'id'
      )
    ),
    coalesce(item ->> 'summary', ''),
    array(select jsonb_array_elements_text(coalesce(item -> 'topics', '[]'::jsonb))),
    coalesce(item ->> 'label', ''),
    coalesce((item ->> 'selected')::boolean, true),
    to_timestamp((item ->> 'createdAt')::double precision / 1000.0)
  from jsonb_array_elements(coalesce(snapshot -> 'sources', '[]'::jsonb)) as item
  on conflict (user_id, id) do update set
    notebook_id = excluded.notebook_id,
    title = excluded.title,
    kind = excluded.kind,
    origin = excluded.origin,
    content = excluded.content,
    summary = excluded.summary,
    topics = excluded.topics,
    label = excluded.label,
    selected = excluded.selected;

  delete from public.sources target
  where target.user_id = current_user_id and target.notebook_id = current_notebook_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(snapshot -> 'sources', '[]'::jsonb)) item
      where item ->> 'id' = target.id
    );

  insert into public.chat_messages (
    user_id, id, notebook_id, role, content, citations, saved, created_at
  )
  select
    current_user_id,
    item ->> 'id',
    current_notebook_id,
    item ->> 'role',
    item ->> 'content',
    coalesce(item -> 'citations', '[]'::jsonb),
    coalesce((item ->> 'saved')::boolean, false),
    to_timestamp((item ->> 'createdAt')::double precision / 1000.0)
  from jsonb_array_elements(coalesce(snapshot -> 'messages', '[]'::jsonb)) as item
  on conflict (user_id, id) do update set
    notebook_id = excluded.notebook_id,
    role = excluded.role,
    content = excluded.content,
    citations = excluded.citations,
    saved = excluded.saved;

  delete from public.chat_messages target
  where target.user_id = current_user_id and target.notebook_id = current_notebook_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(snapshot -> 'messages', '[]'::jsonb)) item
      where item ->> 'id' = target.id
    );

  insert into public.artifacts (
    user_id, id, notebook_id, type, title, status, config, content, error, model, created_at
  )
  select
    current_user_id,
    item ->> 'id',
    current_notebook_id,
    item ->> 'type',
    item ->> 'title',
    item ->> 'status',
    coalesce(item -> 'config', '{}'::jsonb),
    item -> 'content',
    item ->> 'error',
    item ->> 'model',
    to_timestamp((item ->> 'createdAt')::double precision / 1000.0)
  from jsonb_array_elements(coalesce(snapshot -> 'artifacts', '[]'::jsonb)) as item
  on conflict (user_id, id) do update set
    notebook_id = excluded.notebook_id,
    type = excluded.type,
    title = excluded.title,
    status = excluded.status,
    config = excluded.config,
    content = excluded.content,
    error = excluded.error,
    model = excluded.model;

  delete from public.artifacts target
  where target.user_id = current_user_id and target.notebook_id = current_notebook_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(snapshot -> 'artifacts', '[]'::jsonb)) item
      where item ->> 'id' = target.id
    );

  insert into public.notes (
    user_id, id, notebook_id, title, body, locked, created_at
  )
  select
    current_user_id,
    item ->> 'id',
    current_notebook_id,
    item ->> 'title',
    coalesce(item ->> 'body', ''),
    coalesce((item ->> 'locked')::boolean, false),
    to_timestamp((item ->> 'createdAt')::double precision / 1000.0)
  from jsonb_array_elements(coalesce(snapshot -> 'notes', '[]'::jsonb)) as item
  on conflict (user_id, id) do update set
    notebook_id = excluded.notebook_id,
    title = excluded.title,
    body = excluded.body,
    locked = excluded.locked;

  delete from public.notes target
  where target.user_id = current_user_id and target.notebook_id = current_notebook_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(snapshot -> 'notes', '[]'::jsonb)) item
      where item ->> 'id' = target.id
    );
end;
$$;

create or replace function public.load_workspace()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'notebooks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', notebook.id,
          'title', notebook.title,
          'emoji', notebook.emoji,
          'sources', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', source.id,
              'title', source.title,
              'kind', source.kind,
              'origin', source.origin,
              'content', source.content,
              'summary', source.summary,
              'topics', to_jsonb(source.topics),
              'label', source.label,
              'selected', source.selected,
              'createdAt', floor(extract(epoch from source.created_at) * 1000)
            ) order by source.created_at)
            from public.sources source
            where source.user_id = current_user_id and source.notebook_id = notebook.id
          ), '[]'::jsonb),
          'messages', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', message.id,
              'role', message.role,
              'content', message.content,
              'citations', message.citations,
              'saved', case when message.saved then true else null end,
              'createdAt', floor(extract(epoch from message.created_at) * 1000)
            )) order by message.created_at)
            from public.chat_messages message
            where message.user_id = current_user_id and message.notebook_id = notebook.id
          ), '[]'::jsonb),
          'artifacts', coalesce((
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
            where artifact.user_id = current_user_id and artifact.notebook_id = notebook.id
          ), '[]'::jsonb),
          'notes', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', note.id,
              'title', note.title,
              'body', note.body,
              'locked', case when note.locked then true else null end,
              'createdAt', floor(extract(epoch from note.created_at) * 1000)
            )) order by note.created_at)
            from public.notes note
            where note.user_id = current_user_id and note.notebook_id = notebook.id
          ), '[]'::jsonb),
          'chatConfig', jsonb_build_object(
            'style', notebook.chat_style,
            'length', notebook.chat_length,
            'instructions', notebook.chat_instructions
          ),
          'createdAt', floor(extract(epoch from notebook.created_at) * 1000),
          'updatedAt', floor(extract(epoch from notebook.updated_at) * 1000)
        ) order by notebook.updated_at desc
      )
      from public.notebooks notebook
      where notebook.user_id = current_user_id
    ), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_build_object(
        'theme', settings.theme,
        'outputLanguage', settings.output_language
      )
      from public.user_settings settings
      where settings.user_id = current_user_id
    ), jsonb_build_object('theme', 'system', 'outputLanguage', 'English'))
  );
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
          'label', case when shared_notebook.sharing_access = 'full' then source.label else '' end,
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

revoke execute on function public.save_notebook_snapshot(jsonb) from public, anon;
revoke execute on function public.load_workspace() from public, anon;
revoke execute on function private.load_shared_notebook(uuid) from public, anon;
grant execute on function public.save_notebook_snapshot(jsonb) to authenticated, service_role;
grant execute on function public.load_workspace() to authenticated, service_role;
grant execute on function private.load_shared_notebook(uuid) to authenticated;

commit;
