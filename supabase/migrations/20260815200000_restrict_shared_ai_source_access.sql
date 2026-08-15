begin;

-- Without usage on the private schema, a service_role execute grant cannot resolve.
grant usage on schema private to service_role;

-- Chat-only sharing redacts source text in load_shared_notebook, but that RPC still hands
-- out source ids, so a link holder could call this one and recover the redacted text.
-- Grounding runs inside the Edge Function, so service_role-only makes the redaction an
-- authorization boundary rather than a client-side convention.
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
begin
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

revoke execute on function public.load_shared_ai_sources(uuid, text, text[]) from public, anon, authenticated;
revoke execute on function private.load_shared_ai_sources(uuid, text, text[]) from public, anon, authenticated;

grant execute on function public.load_shared_ai_sources(uuid, text, text[]) to service_role;
grant execute on function private.load_shared_ai_sources(uuid, text, text[]) to service_role;

commit;
