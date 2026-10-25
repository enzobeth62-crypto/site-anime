-- Animeverse chat moderation and 30-day message retention.
-- The moderator row is seeded only from the verified account named in the approved setup.
create extension if not exists pg_cron;

create table if not exists public.chat_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.chat_moderators (user_id)
select id from auth.users
where lower(email) = lower('bhadenzo28@gmail.com')
  and email_confirmed_at is not null
on conflict (user_id) do nothing;

create table if not exists public.chat_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  banned_by uuid not null references auth.users(id) on delete restrict,
  reason text not null default 'Non-respect des règles du chat',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint chat_bans_reason_length check (char_length(reason) between 1 and 300),
  constraint chat_bans_expiry_after_creation check (expires_at is null or expires_at > created_at)
);

create table if not exists public.chat_moderation_logs (
  id bigint generated always as identity primary key,
  action text not null check (action in ('delete_message','ban_user','unban_user','update_ban','retention_purge')),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  message_id bigint,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at desc);
create index if not exists chat_moderation_logs_created_at_idx on public.chat_moderation_logs (created_at desc);

alter table public.chat_moderators enable row level security;
alter table public.chat_bans enable row level security;
alter table public.chat_moderation_logs enable row level security;

revoke all on table public.chat_moderators from anon, authenticated;
grant select on table public.chat_moderators to authenticated;
revoke all on table public.chat_bans from anon, authenticated;
grant select, insert, update, delete on table public.chat_bans to authenticated;
revoke all on table public.chat_moderation_logs from anon, authenticated;
grant select on table public.chat_moderation_logs to authenticated;

drop policy if exists "chat moderators can read own admin record" on public.chat_moderators;
create policy "chat moderators can read own admin record" on public.chat_moderators
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "chat users can read own ban and moderators can read all" on public.chat_bans;
create policy "chat users can read own ban and moderators can read all" on public.chat_bans
for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

drop policy if exists "chat moderators can create bans" on public.chat_bans;
create policy "chat moderators can create bans" on public.chat_bans
for insert to authenticated with check (
  banned_by = (select auth.uid())
  and exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

drop policy if exists "chat moderators can update bans" on public.chat_bans;
create policy "chat moderators can update bans" on public.chat_bans
for update to authenticated
using (exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid())))
with check (
  banned_by = (select auth.uid())
  and exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

drop policy if exists "chat moderators can remove bans" on public.chat_bans;
create policy "chat moderators can remove bans" on public.chat_bans
for delete to authenticated using (
  exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

drop policy if exists "chat moderators can read moderation logs" on public.chat_moderation_logs;
create policy "chat moderators can read moderation logs" on public.chat_moderation_logs
for select to authenticated using (
  exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

drop policy if exists "Authenticated users can read chat" on public.chat_messages;
drop policy if exists "Authenticated users can send chat messages" on public.chat_messages;

create policy "Authenticated users can read recent chat" on public.chat_messages
for select to authenticated using (
  created_at >= now() - interval '30 days'
  or exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

create policy "Authenticated users can send unbanned chat messages" on public.chat_messages
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and not exists (
    select 1 from public.chat_bans b
    where b.user_id = (select auth.uid())
      and (b.expires_at is null or b.expires_at > now())
  )
);

drop policy if exists "Chat moderators can delete messages" on public.chat_messages;
create policy "Chat moderators can delete messages" on public.chat_messages
for delete to authenticated using (
  exists (select 1 from public.chat_moderators m where m.user_id = (select auth.uid()))
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.log_chat_message_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then
    return old;
  end if;
  if not exists (select 1 from public.chat_moderators m where m.user_id = actor_id) then
    raise exception 'Only chat moderators may delete messages';
  end if;
  insert into public.chat_moderation_logs (action, actor_user_id, target_user_id, message_id, details)
  values ('delete_message', actor_id, old.user_id, old.id,
          jsonb_build_object('message_created_at', old.created_at));
  return old;
end;
$$;

create or replace function private.log_chat_ban_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if not exists (select 1 from public.chat_moderators m where m.user_id = actor_id) then
    raise exception 'Only chat moderators may change chat bans';
  end if;
  if tg_op = 'INSERT' then
    insert into public.chat_moderation_logs (action, actor_user_id, target_user_id, details)
    values ('ban_user', actor_id, new.user_id,
            jsonb_build_object('reason', new.reason, 'expires_at', new.expires_at));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.chat_moderation_logs (action, actor_user_id, target_user_id, details)
    values ('update_ban', actor_id, new.user_id,
            jsonb_build_object('reason', new.reason, 'expires_at', new.expires_at));
    return new;
  else
    insert into public.chat_moderation_logs (action, actor_user_id, target_user_id, details)
    values ('unban_user', actor_id, old.user_id,
            jsonb_build_object('reason', old.reason));
    return old;
  end if;
end;
$$;

drop trigger if exists chat_message_deletion_audit on public.chat_messages;
create trigger chat_message_deletion_audit
after delete on public.chat_messages
for each row execute function private.log_chat_message_deletion();

drop trigger if exists chat_ban_change_audit on public.chat_bans;
create trigger chat_ban_change_audit
after insert or update or delete on public.chat_bans
for each row execute function private.log_chat_ban_change();

select cron.schedule(
  'animeverse-chat-retention',
  '0 3 * * *',
  $job$
    with deleted as (
      delete from public.chat_messages
      where created_at < now() - interval '30 days'
      returning id
    )
    insert into public.chat_moderation_logs (action, details)
    select 'retention_purge', jsonb_build_object('deleted_count', count(*))
    from deleted
    having count(*) > 0
  $job$
);
