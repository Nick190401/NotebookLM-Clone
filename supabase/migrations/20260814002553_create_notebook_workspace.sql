begin;

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  output_language text not null default 'English' check (output_language in ('English', 'Deutsch')),
  updated_at timestamptz not null default now()
);

create table public.notebooks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 128),
  title text not null check (char_length(title) between 1 and 500),
  emoji text not null default '📓' check (char_length(emoji) between 1 and 32),
  chat_style text not null default 'Default' check (chat_style in ('Default', 'Learning Guide', 'Custom')),
  chat_length text not null default 'Default' check (chat_length in ('Shorter', 'Default', 'Longer')),
  chat_instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.sources (
  user_id uuid not null,
  id text not null check (char_length(id) between 1 and 128),
  notebook_id text not null,
  title text not null check (char_length(title) between 1 and 1000),
  kind text not null check (kind in ('pdf', 'web', 'youtube', 'text', 'audio', 'image')),
  origin text not null default '',
  content text not null check (char_length(content) > 0),
  summary text not null default '',
  topics text[] not null default '{}',
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, notebook_id) references public.notebooks(user_id, id) on delete cascade
);

create table public.chat_messages (
  user_id uuid not null,
  id text not null check (char_length(id) between 1 and 128),
  notebook_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) > 0),
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  saved boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, notebook_id) references public.notebooks(user_id, id) on delete cascade
);

create table public.artifacts (
  user_id uuid not null,
  id text not null check (char_length(id) between 1 and 128),
  notebook_id text not null,
  type text not null check (type in ('audio', 'video', 'mindmap', 'report', 'flashcards', 'quiz', 'infographic', 'slides', 'datatable')),
  title text not null check (char_length(title) between 1 and 1000),
  status text not null check (status in ('generating', 'ready', 'error')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  content jsonb check (content is null or jsonb_typeof(content) = 'object'),
  error text,
  model text,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, notebook_id) references public.notebooks(user_id, id) on delete cascade
);

create table public.notes (
  user_id uuid not null,
  id text not null check (char_length(id) between 1 and 128),
  notebook_id text not null,
  title text not null check (char_length(title) between 1 and 1000),
  body text not null default '',
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, notebook_id) references public.notebooks(user_id, id) on delete cascade
);

create index notebooks_user_updated_idx on public.notebooks (user_id, updated_at desc);
create index sources_notebook_created_idx on public.sources (user_id, notebook_id, created_at);
create index chat_messages_notebook_created_idx on public.chat_messages (user_id, notebook_id, created_at);
create index artifacts_notebook_created_idx on public.artifacts (user_id, notebook_id, created_at);
create index notes_notebook_created_idx on public.notes (user_id, notebook_id, created_at);

alter table public.user_settings enable row level security;
alter table public.notebooks enable row level security;
alter table public.sources enable row level security;
alter table public.chat_messages enable row level security;
alter table public.artifacts enable row level security;
alter table public.notes enable row level security;

create policy user_settings_owner_access on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy notebooks_owner_access on public.notebooks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy sources_owner_access on public.sources
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy chat_messages_owner_access on public.chat_messages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy artifacts_owner_access on public.artifacts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy notes_owner_access on public.notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_settings, public.notebooks, public.sources, public.chat_messages, public.artifacts, public.notes from anon;
grant select, insert, update, delete on public.user_settings, public.notebooks, public.sources, public.chat_messages, public.artifacts, public.notes to authenticated;
grant all on public.user_settings, public.notebooks, public.sources, public.chat_messages, public.artifacts, public.notes to service_role;

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
    user_id, id, notebook_id, title, kind, origin, content, summary, topics, selected, created_at
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

create or replace function public.clear_workspace()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  delete from public.notebooks where user_id = current_user_id;
  delete from public.user_settings where user_id = current_user_id;
end;
$$;

create or replace function public.load_ai_sources(
  requested_notebook_id text,
  requested_source_ids text[]
)
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
  if requested_notebook_id is null or requested_notebook_id = '' then
    raise exception 'Notebook id is required' using errcode = '22023';
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
    from public.sources source
    where source.user_id = current_user_id
      and source.notebook_id = requested_notebook_id
      and source.id = any(requested_source_ids)
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.save_notebook_snapshot(jsonb) from public, anon;
revoke execute on function public.load_workspace() from public, anon;
revoke execute on function public.clear_workspace() from public, anon;
revoke execute on function public.load_ai_sources(text, text[]) from public, anon;
grant execute on function public.save_notebook_snapshot(jsonb) to authenticated, service_role;
grant execute on function public.load_workspace() to authenticated, service_role;
grant execute on function public.clear_workspace() to authenticated, service_role;
grant execute on function public.load_ai_sources(text, text[]) to authenticated, service_role;

commit;
