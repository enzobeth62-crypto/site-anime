create table if not exists public.assistant_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, public;
grant select on public.assistant_usage to authenticated;
drop policy if exists "Users can read own assistant usage" on public.assistant_usage;
create policy "Users can read own assistant usage"
  on public.assistant_usage for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.consume_assistant_message()
returns integer
language plpgsql
security definer
set search_path = ''
as $20261025140000_add_assistant_usage_quota_01$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  insert into public.assistant_usage(user_id, day, count)
  values (v_user, v_day, 1)
  on conflict (user_id, day) do update
    set count = public.assistant_usage.count + 1
    where public.assistant_usage.count < 30
  returning count into v_count;
  if not found then
    return 31;
  end if;
  return v_count;
end;
$20261025140000_add_assistant_usage_quota_01$;
revoke all on function public.consume_assistant_message() from public, anon;
grant execute on function public.consume_assistant_message() to authenticated;