begin;

-- Anonymous sign-ins are enabled, so a per-account quota is the only brake on a caller
-- draining the shared Groq budget. The counters stay unreachable from the client: RLS on
-- with no policy, all grants revoked, and the sole writer derives the account from auth.uid().

create table public.ai_quota_policies (
  bucket text primary key check (char_length(bucket) between 1 and 40),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  max_requests integer not null check (max_requests between 1 and 100000),
  description text not null default ''
);

create table public.ai_quota_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null references public.ai_quota_policies(bucket) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, bucket, window_start)
);

create index ai_quota_counters_window_idx on public.ai_quota_counters (window_start);

insert into public.ai_quota_policies (bucket, window_seconds, max_requests, description) values
  ('chat', 3600, 60, 'Grounded chat answers per hour'),
  ('artifact', 3600, 20, 'Studio artifact generations per hour'),
  ('research', 3600, 8, 'Multi-step Deep Research runs per hour'),
  ('discover', 3600, 30, 'Fast web source discovery runs per hour'),
  ('speech', 3600, 10, 'Audio overview syntheses per hour'),
  ('import', 3600, 40, 'Source imports per hour');

alter table public.ai_quota_policies enable row level security;
alter table public.ai_quota_counters enable row level security;

revoke all on public.ai_quota_policies, public.ai_quota_counters from public, anon, authenticated;
grant all on public.ai_quota_policies, public.ai_quota_counters to service_role;

create or replace function private.consume_ai_quota(requested_bucket text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  quota public.ai_quota_policies%rowtype;
  current_window timestamptz;
  used integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into quota from public.ai_quota_policies where bucket = requested_bucket;
  if not found then
    raise exception 'Unknown quota bucket' using errcode = '22023';
  end if;

  -- Fixed windows keyed by their start; the previous one is dropped on the next call, so the
  -- counters need no scheduled cleanup.
  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / quota.window_seconds) * quota.window_seconds
  );

  delete from public.ai_quota_counters stale
  where stale.user_id = current_user_id
    and stale.window_start < current_window - make_interval(secs => quota.window_seconds);

  insert into public.ai_quota_counters as counter (user_id, bucket, window_start, request_count)
  values (current_user_id, requested_bucket, current_window, 1)
  on conflict (user_id, bucket, window_start)
    do update set request_count = counter.request_count + 1
  returning counter.request_count into used;

  if used > quota.max_requests then
    -- A refused call must not extend the lockout, so the reservation is released.
    update public.ai_quota_counters counter
    set request_count = counter.request_count - 1
    where counter.user_id = current_user_id
      and counter.bucket = requested_bucket
      and counter.window_start = current_window;

    return jsonb_build_object(
      'allowed', false,
      'bucket', requested_bucket,
      'limit', quota.max_requests,
      'remaining', 0,
      'retryAfterSeconds', greatest(
        1,
        ceil(extract(epoch from (current_window + make_interval(secs => quota.window_seconds)) - clock_timestamp()))::integer
      )
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'bucket', requested_bucket,
    'limit', quota.max_requests,
    'remaining', quota.max_requests - used,
    'retryAfterSeconds', 0
  );
end;
$$;

create or replace function public.consume_ai_quota(requested_bucket text)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as 'select private.consume_ai_quota(requested_bucket)';

revoke execute on function private.consume_ai_quota(text) from public, anon;
revoke execute on function public.consume_ai_quota(text) from public, anon;
grant execute on function private.consume_ai_quota(text) to authenticated, service_role;
grant execute on function public.consume_ai_quota(text) to authenticated, service_role;

commit;
