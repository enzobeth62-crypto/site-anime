-- Animeverse: chat roles, granular permissions and auditable moderation
-- Run once in Supabase SQL Editor. No service-role key is used by the browser.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.chat_moderators
  add column if not exists role text not null default 'moderator',
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists max_ban_minutes integer not null default 10080,
  add column if not exists can_permanent_ban boolean not null default false,
  add column if not exists appointed_by uuid,
  add column if not exists appointed_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.chat_moderators'::regclass and conname='chat_moderators_role_check') then
    alter table public.chat_moderators add constraint chat_moderators_role_check check (role in ('moderator'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.chat_moderators'::regclass and conname='chat_moderators_max_ban_check') then
    alter table public.chat_moderators add constraint chat_moderators_max_ban_check check (max_ban_minutes between 0 and 43200);
  end if;
end $$;

create table if not exists public.chat_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  moderator_id uuid not null references auth.users(id),
  reason text not null check (char_length(reason) between 1 and 1000),
  message_id bigint references public.chat_messages(id) on delete set null,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_warnings_user_created_idx on public.chat_warnings(user_id, created_at desc);

create table if not exists public.chat_mutes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  muted_by uuid not null references auth.users(id),
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists chat_mutes_expires_idx on public.chat_mutes(expires_at);

create table if not exists public.chat_moderation_settings (
  singleton boolean primary key default true check (singleton),
  warning_threshold integer not null default 3 check (warning_threshold between 1 and 20),
  updated_at timestamptz not null default now()
);
insert into public.chat_moderation_settings(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check(status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists chat_reports_created_idx on public.chat_reports(created_at desc);
alter table public.chat_messages add column if not exists reply_to_id bigint references public.chat_messages(id) on delete set null;

alter table public.chat_moderation_logs drop constraint if exists chat_moderation_logs_action_check;
alter table public.chat_moderation_logs add constraint chat_moderation_logs_action_check
  check (action in ('delete_message','ban_user','unban_user','update_ban','warn_user','mute_user','unmute_user','report_message','resolve_report','video_published','appoint_moderator','remove_moderator','update_moderator_permissions','update_settings','retention_purge'));

-- Seed/repair the single protected super-admin record if the confirmed account exists.
insert into public.chat_moderators(user_id, role, permissions, max_ban_minutes, can_permanent_ban, appointed_at)
select id, 'moderator',
  '{"delete_messages":true,"warn":true,"mute":true,"ban":true,"view_history":true,"manage_forum":true,"view_logs":true,"publish_video":true,"manage_reports":true}'::jsonb,
  43200, true, now()
from auth.users
where lower(email)='bhadenzo28@gmail.com' and email_confirmed_at is not null
on conflict (user_id) do update set
  permissions=excluded.permissions, max_ban_minutes=43200, can_permanent_ban=true;

create or replace function private.chat_is_super_admin(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path=''
as $$
  select p_uid is not null and exists(
    select 1 from auth.users u
    where u.id=p_uid and lower(u.email)='bhadenzo28@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;
create or replace function private.chat_has_permission(p_permission text, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path=''
as $$
 select coalesce(private.chat_is_super_admin(p_uid),false) or exists(
   select 1 from public.chat_moderators m
   where m.user_id=p_uid and m.role='moderator'
     and coalesce((m.permissions->>p_permission)::boolean,false)
 );
$$;
create or replace function private.chat_can_moderate(p_permission text, p_target uuid default null)
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null
   and (p_target is null or not private.chat_is_super_admin(p_target))
   and (private.chat_is_super_admin(auth.uid()) or p_target is null or p_target=auth.uid() or not exists(select 1 from public.chat_moderators m where m.user_id=p_target))
   and private.chat_has_permission(p_permission,auth.uid());
$$;
create or replace function private.chat_cannot_send(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.chat_bans b where b.user_id=p_uid and (b.expires_at is null or b.expires_at>now()))
    or exists(select 1 from public.chat_mutes m where m.user_id=p_uid and m.expires_at>now());
$$;
grant usage on schema private to authenticated;
grant execute on function private.chat_is_super_admin(uuid), private.chat_has_permission(text,uuid), private.chat_can_moderate(text,uuid), private.chat_cannot_send(uuid) to authenticated;

create or replace function private.log_video_post()
returns trigger language plpgsql security definer set search_path=''
as $video$
begin
 insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details)
 values('video_published',new.user_id,new.user_id,jsonb_build_object('title',new.title));
 return new;
end
$video$;
drop trigger if exists animeverse_video_post_audit on public.video_posts;
create trigger animeverse_video_post_audit after insert on public.video_posts for each row execute function private.log_video_post();

-- Role/permission data safe for the signed-in caller.
create or replace function public.chat_my_permissions()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_row public.chat_moderators%rowtype;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if private.chat_is_super_admin(v_uid) then
   return jsonb_build_object('role','super_admin','permissions',jsonb_build_object('delete_messages',true,'warn',true,'mute',true,'ban',true,'view_history',true,'manage_forum',true,'view_logs',true,'publish_video',true,'manage_reports',true),'max_ban_minutes',43200,'can_permanent_ban',true);
 end if;
 select * into v_row from public.chat_moderators where user_id=v_uid and role='moderator';
 if not found then return jsonb_build_object('role','member','permissions','{}'::jsonb,'max_ban_minutes',0,'can_permanent_ban',false); end if;
 return jsonb_build_object('role','moderator','permissions',v_row.permissions,'max_ban_minutes',v_row.max_ban_minutes,'can_permanent_ban',v_row.can_permanent_ban);
end $$;

create or replace function public.chat_role_badges(p_users uuid[]) returns table(user_id uuid,role text) language sql stable security definer set search_path='' as $role$ select u.id,case when private.chat_is_super_admin(u.id) then 'super_admin' when m.user_id is not null then 'moderator' else 'member' end from auth.users u left join public.chat_moderators m on m.user_id=u.id where u.id=any(coalesce(p_users,'{}'::uuid[])); $role$;
create or replace function public.chat_admin_search_users(p_query text)
returns table(user_id uuid, display_name text, email text, created_at timestamptz, role text)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.chat_is_super_admin(auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 if char_length(trim(coalesce(p_query,'')))<2 then return; end if;
 return query
 select u.id, coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name','Membre'),u.email,u.created_at,
   case when private.chat_is_super_admin(u.id) then 'super_admin' when m.user_id is not null then 'moderator' else 'member' end
 from auth.users u left join public.chat_moderators m on m.user_id=u.id
 where (u.email ilike '%'||trim(p_query)||'%' or coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name','') ilike '%'||trim(p_query)||'%')
 order by u.created_at desc limit 20;
end $$;

create or replace function public.chat_admin_list_moderators()
returns table(user_id uuid, display_name text, email text, appointed_at timestamptz, permissions jsonb, max_ban_minutes integer, can_permanent_ban boolean)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.chat_is_super_admin(auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 return query select m.user_id,coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name','Membre'),u.email,m.appointed_at,m.permissions,m.max_ban_minutes,m.can_permanent_ban
 from public.chat_moderators m join auth.users u on u.id=m.user_id
 where not private.chat_is_super_admin(m.user_id) order by m.appointed_at desc;
end $$;

create or replace function public.chat_admin_set_moderator(p_email text,p_is_moderator boolean,p_permissions jsonb default '{}'::jsonb,p_max_ban_minutes integer default 10080,p_can_permanent_ban boolean default false)
returns void language plpgsql security definer set search_path=''
as $$
declare v_target uuid; v_actor uuid:=auth.uid(); v_caps constant text[]:=array['delete_messages','warn','mute','ban','view_history','manage_forum','view_logs','publish_video','manage_reports'];
begin
 if not private.chat_is_super_admin(v_actor) then raise exception 'Forbidden' using errcode='42501'; end if;
 select id into v_target from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if v_target is null then raise exception 'Utilisateur introuvable ou compte non confirmé'; end if;
 if private.chat_is_super_admin(v_target) then raise exception 'Le super administrateur est protégé'; end if;
 if p_is_moderator then
   if p_max_ban_minutes<0 or p_max_ban_minutes>43200 then raise exception 'Durée maximale invalide'; end if;
   if exists(select 1 from jsonb_object_keys(coalesce(p_permissions,'{}'::jsonb)) as k(key) where not (k.key=any(v_caps))) then raise exception 'Permission inconnue'; end if;
   insert into public.chat_moderators(user_id,role,permissions,max_ban_minutes,can_permanent_ban,appointed_by,appointed_at)
   values(v_target,'moderator',coalesce(p_permissions,'{}'::jsonb),p_max_ban_minutes,p_can_permanent_ban,v_actor,now())
   on conflict(user_id) do update set permissions=excluded.permissions,max_ban_minutes=excluded.max_ban_minutes,can_permanent_ban=excluded.can_permanent_ban;
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details) values('appoint_moderator',v_actor,v_target,jsonb_build_object('permissions',p_permissions,'max_ban_minutes',p_max_ban_minutes,'can_permanent_ban',p_can_permanent_ban));
 else
   delete from public.chat_moderators where user_id=v_target and not private.chat_is_super_admin(user_id);
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details) values('remove_moderator',v_actor,v_target,'{}'::jsonb);
 end if;
end $$;

create or replace function public.chat_admin_user_panel(p_target uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare u auth.users%rowtype; v_role text;
begin
 if not private.chat_has_permission('view_history',auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 if private.chat_is_super_admin(p_target) then
   -- The protected account may be inspected, but never sanctioned.
   null;
 end if;
 select * into u from auth.users where id=p_target;
 if not found then raise exception 'Utilisateur introuvable'; end if;
 v_role:=case when private.chat_is_super_admin(p_target) then 'super_admin' when exists(select 1 from public.chat_moderators where user_id=p_target) then 'moderator' else 'member' end;
 return jsonb_build_object('user_id',u.id,'display_name',coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name','Membre'),'avatar_url',u.raw_user_meta_data->>'avatar_url','created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,'role',v_role,
 'message_count',(select count(*) from public.chat_messages where user_id=p_target),
 'warning_count',(select count(*) from public.chat_warnings where user_id=p_target),
 'ban_count',(select count(*) from public.chat_moderation_logs where target_user_id=p_target and action in ('ban_user','update_ban')));
end $$;

create or replace function public.chat_admin_user_messages(p_target uuid,p_query text default null)
returns table(id bigint,content text,created_at timestamptz,display_name text,reply_to_id bigint)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.chat_has_permission('view_history',auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 return query select m.id,m.content,m.created_at,m.display_name,m.reply_to_id from public.chat_messages m
 where m.user_id=p_target and (nullif(trim(p_query),'') is null or m.content ilike '%'||p_query||'%')
 order by m.created_at desc limit 200;
end $$;

create or replace function public.chat_admin_user_sanctions(p_target uuid)
returns table(action text,reason text,duration text,created_at timestamptz,actor_user_id uuid)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.chat_has_permission('view_history',auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 return query
 select l.action,coalesce(l.details->>'reason',''),coalesce(l.details->>'duration',''),l.created_at,l.actor_user_id
 from public.chat_moderation_logs l where l.target_user_id=p_target order by l.created_at desc limit 200;
end $$;

create or replace function public.chat_moderation_action(p_action text,p_target uuid,p_reason text default '',p_duration text default null,p_message_id bigint default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid(); v_expiry timestamptz; v_permission text;
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_target is null or p_target=auth.uid() or private.chat_is_super_admin(p_target) then raise exception 'Compte protégé' using errcode='42501'; end if;
 if exists(select 1 from public.chat_moderators where user_id=p_target) and not private.chat_is_super_admin(v_actor) then raise exception 'Un modérateur ne peut pas sanctionner un modérateur' using errcode='42501'; end if;
 if char_length(trim(coalesce(p_reason,'')))<2 or char_length(p_reason)>1000 then raise exception 'Un motif valide est obligatoire'; end if;
 v_permission:=case p_action when 'delete_message' then 'delete_messages' when 'warn' then 'warn' when 'ban' then 'ban' when 'unban' then 'ban' when 'mute' then 'mute' when 'unmute' then 'mute' when 'delete_all' then 'delete_messages' else null end;
 if v_permission is null or not private.chat_can_moderate(v_permission,p_target) then raise exception 'Permission insuffisante' using errcode='42501'; end if;
 if p_action='delete_message' then
   if p_message_id is null then raise exception 'Message manquant'; end if;
   delete from public.chat_messages where id=p_message_id and user_id=p_target;
   if not found then raise exception 'Message introuvable'; end if;
   -- The existing deletion trigger records this action in chat_moderation_logs.
 elsif p_action='delete_all' then
   delete from public.chat_messages where user_id=p_target;
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details) values('delete_message',v_actor,p_target,jsonb_build_object('reason',p_reason,'delete_all',true));
 elsif p_action='warn' then
   insert into public.chat_warnings(user_id,moderator_id,reason,message_id) values(p_target,v_actor,trim(p_reason),p_message_id);
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,message_id,details) values('warn_user',v_actor,p_target,p_message_id,jsonb_build_object('reason',trim(p_reason)));
 elsif p_action='ban' then
   if p_duration='permanent' then
     if not private.chat_is_super_admin(v_actor) and not exists(select 1 from public.chat_moderators where user_id=v_actor and can_permanent_ban) then raise exception 'Ban définitif non autorisé' using errcode='42501'; end if;
     v_expiry:=null;
   else
     v_expiry:=now()+case p_duration when '1h' then interval '1 hour' when '24h' then interval '24 hours' when '7d' then interval '7 days' when '30d' then interval '30 days' else null end;
     if v_expiry is null then raise exception 'Durée invalide'; end if;
     if not private.chat_is_super_admin(v_actor) and exists(select 1 from public.chat_moderators m where m.user_id=v_actor and extract(epoch from (v_expiry-now()))/60>m.max_ban_minutes) then raise exception 'Durée supérieure à votre limite'; end if;
   end if;
   insert into public.chat_bans(user_id,banned_by,reason,expires_at) values(p_target,v_actor,trim(p_reason),v_expiry)
   on conflict(user_id) do update set banned_by=excluded.banned_by,reason=excluded.reason,created_at=now(),expires_at=excluded.expires_at;
   -- The existing chat_bans audit trigger records ban creation and updates.
 elsif p_action='unban' then
   delete from public.chat_bans where user_id=p_target;
   if not found then raise exception 'Aucun bannissement actif'; end if;
   -- The existing chat_bans audit trigger records the reactivation.
 elsif p_action='mute' then
   if p_duration not in ('1h','24h','7d','30d') then raise exception 'Durée invalide'; end if;
   v_expiry:=now()+case p_duration when '1h' then interval '1 hour' when '24h' then interval '24 hours' when '7d' then interval '7 days' else interval '30 days' end;
   insert into public.chat_mutes(user_id,muted_by,reason,created_at,expires_at) values(p_target,v_actor,trim(p_reason),now(),v_expiry)
   on conflict(user_id) do update set muted_by=excluded.muted_by,reason=excluded.reason,created_at=now(),expires_at=excluded.expires_at;
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details) values('mute_user',v_actor,p_target,jsonb_build_object('reason',trim(p_reason),'duration',p_duration));
 elsif p_action='unmute' then
   delete from public.chat_mutes where user_id=p_target;
   if not found then raise exception 'Aucun mute actif'; end if;
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details) values('unmute_user',v_actor,p_target,jsonb_build_object('reason',trim(p_reason)));
 end if;
 return jsonb_build_object('ok',true,'action',p_action,'warning_count',(select count(*) from public.chat_warnings where user_id=p_target),'warning_threshold',(select warning_threshold from public.chat_moderation_settings where singleton=true));
end $$;

create or replace function public.chat_report_message(p_message_id bigint,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_target uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select user_id into v_target from public.chat_messages where id=p_message_id;
 if v_target is null or v_target=auth.uid() then raise exception 'Signalement invalide'; end if;
 if char_length(trim(coalesce(p_reason,'')))<2 or char_length(p_reason)>1000 then raise exception 'Motif invalide'; end if;
 insert into public.chat_reports(message_id,reporter_id,target_user_id,reason) values(p_message_id,auth.uid(),v_target,trim(p_reason));
 insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,message_id,details) values('report_message',auth.uid(),v_target,p_message_id,jsonb_build_object('reason',trim(p_reason)));
end $$;

create or replace function public.chat_admin_resolve_report(p_report_id uuid,p_status text)
returns void language plpgsql security definer set search_path=''
as $resolve$
declare v_target uuid; v_message bigint;
begin
 if not private.chat_has_permission('manage_reports',auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_status not in ('resolved','dismissed') then raise exception 'État invalide'; end if;
 update public.chat_reports set status=p_status where id=p_report_id returning target_user_id,message_id into v_target,v_message;
 if not found then raise exception 'Signalement introuvable'; end if;
 insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,message_id,details)
 values('resolve_report',auth.uid(),v_target,v_message,jsonb_build_object('status',p_status));
end
$resolve$;

create or replace function public.chat_mark_warnings_seen()
returns integer language plpgsql security definer set search_path=''
as $$
declare n integer;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 update public.chat_warnings set seen=true where user_id=auth.uid() and not seen;
 get diagnostics n=row_count; return n;
end $$;

create or replace function public.chat_get_warning_threshold() returns integer language plpgsql stable security definer set search_path='' as $threshold$ begin if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; return (select warning_threshold from public.chat_moderation_settings where singleton=true); end $threshold$;
create or replace function public.chat_admin_update_settings(p_warning_threshold integer)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not private.chat_is_super_admin(auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_warning_threshold not between 1 and 20 then raise exception 'Seuil invalide'; end if;
 update public.chat_moderation_settings set warning_threshold=p_warning_threshold,updated_at=now() where singleton=true;
 insert into public.chat_moderation_logs(action,actor_user_id,details) values('update_settings',auth.uid(),jsonb_build_object('warning_threshold',p_warning_threshold));
end $$;

create or replace function public.chat_admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.chat_is_super_admin(auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 return (select jsonb_build_object('warning_threshold',warning_threshold) from public.chat_moderation_settings where singleton=true);
end $$;

create or replace function public.chat_admin_list_reports()
returns table(id uuid,message_id bigint,target_user_id uuid,reason text,created_at timestamptz,status text)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.chat_has_permission('manage_reports',auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
 return query select r.id,r.message_id,r.target_user_id,r.reason,r.created_at,r.status from public.chat_reports r where r.status='open' order by r.created_at desc limit 100;
end $$;

-- RLS: no direct write path for moderator records or restrictions; all changes go through checked RPCs.
alter table public.chat_moderators enable row level security;
alter table public.chat_warnings enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_reports enable row level security;
alter table public.chat_moderation_settings enable row level security;
alter table public.chat_bans enable row level security;
alter table public.chat_moderation_logs enable row level security;
alter table public.chat_messages enable row level security;

-- Remove legacy policies on protected tables, since PostgreSQL combines permissive policies with OR.
do $policy$ declare r record; begin for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('chat_moderators','chat_bans','chat_warnings','chat_mutes','chat_reports','chat_moderation_settings','chat_moderation_logs','chat_reactions','video_posts','chat_messages') loop execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop; end $policy$;

drop policy if exists chat_moderators_select_self on public.chat_moderators;
drop policy if exists chat_moderators_select_own on public.chat_moderators;
drop policy if exists chat_moderators_select_all on public.chat_moderators;
create policy chat_moderators_select_own on public.chat_moderators for select to authenticated using(user_id=auth.uid());
drop policy if exists chat_moderators_insert_admin on public.chat_moderators;
drop policy if exists chat_moderators_update_admin on public.chat_moderators;
drop policy if exists chat_moderators_delete_admin on public.chat_moderators;
revoke insert,update,delete on public.chat_moderators from anon,authenticated;

drop policy if exists chat_warnings_read_own_or_mod on public.chat_warnings;
create policy chat_warnings_read_own_or_mod on public.chat_warnings for select to authenticated using(user_id=auth.uid() or private.chat_has_permission('view_history',auth.uid()));
drop policy if exists chat_warnings_update_seen_own on public.chat_warnings;
create policy chat_warnings_update_seen_own on public.chat_warnings for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke insert,delete on public.chat_warnings from anon,authenticated;

drop policy if exists chat_mutes_read_own_or_mod on public.chat_mutes;
create policy chat_mutes_read_own_or_mod on public.chat_mutes for select to authenticated using(user_id=auth.uid() or private.chat_has_permission('view_history',auth.uid()));
revoke insert,update,delete on public.chat_mutes from anon,authenticated;

drop policy if exists chat_reports_read_moderator on public.chat_reports;
create policy chat_reports_read_moderator on public.chat_reports for select to authenticated using(private.chat_has_permission('manage_reports',auth.uid()));
revoke insert,update,delete on public.chat_reports from anon,authenticated;

drop policy if exists chat_moderation_settings_admin on public.chat_moderation_settings;
create policy chat_moderation_settings_admin on public.chat_moderation_settings for select to authenticated using(private.chat_is_super_admin(auth.uid()));
revoke insert,update,delete on public.chat_moderation_settings from anon,authenticated;

drop policy if exists chat_bans_select_own_or_mod on public.chat_bans;
create policy chat_bans_select_own_or_mod on public.chat_bans for select to authenticated using(user_id=auth.uid() or private.chat_has_permission('view_history',auth.uid()));
drop policy if exists chat_bans_insert_mod on public.chat_bans;
drop policy if exists chat_bans_update_mod on public.chat_bans;
drop policy if exists chat_bans_delete_mod on public.chat_bans;
revoke insert,update,delete on public.chat_bans from anon,authenticated;

drop policy if exists chat_moderation_logs_select_mod on public.chat_moderation_logs;
create policy chat_moderation_logs_select_mod on public.chat_moderation_logs for select to authenticated using(private.chat_has_permission('view_logs',auth.uid()));
revoke insert,update,delete on public.chat_moderation_logs from anon,authenticated;

drop policy if exists chat_messages_select_recent on public.chat_messages;
create policy chat_messages_select_recent on public.chat_messages for select to authenticated using(created_at >= now()-interval '30 days' or private.chat_has_permission('view_history',auth.uid()));
grant select,insert,delete on public.chat_messages to authenticated;
drop policy if exists chat_messages_insert_authenticated on public.chat_messages;
drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own on public.chat_messages for insert to authenticated
 with check(user_id=auth.uid() and not private.chat_cannot_send(auth.uid()));
drop policy if exists chat_messages_delete_moderator on public.chat_messages;
create policy chat_messages_delete_moderator on public.chat_messages for delete to authenticated using(private.chat_can_moderate('delete_messages',user_id));

-- Remove any permissive legacy moderator write policies (policy OR semantics would otherwise bypass the new gates).
do $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='chat_messages' and cmd in ('INSERT','DELETE') loop
   if p.policyname not in ('chat_messages_insert_own','chat_messages_delete_moderator') then
     execute format('drop policy if exists %I on public.chat_messages',p.policyname);
   end if;
 end loop;
end $$;

drop policy if exists chat_reactions_select_authenticated on public.chat_reactions;
create policy chat_reactions_select_authenticated on public.chat_reactions for select to authenticated using(true);
grant select,insert,delete on public.chat_reactions to authenticated;
drop policy if exists chat_reactions_insert_own on public.chat_reactions;
create policy chat_reactions_insert_own on public.chat_reactions for insert to authenticated with check(user_id=auth.uid() and not private.chat_cannot_send(auth.uid()));
drop policy if exists chat_reactions_delete_own on public.chat_reactions;
create policy chat_reactions_delete_own on public.chat_reactions for delete to authenticated using(user_id=auth.uid() and not private.chat_cannot_send(auth.uid()));

-- Preserve member video publishing, while a mute/ban applies to every contribution.
drop policy if exists video_posts_insert_own on public.video_posts;
create policy video_posts_insert_own on public.video_posts for insert to authenticated
 with check(user_id=auth.uid() and not private.chat_cannot_send(auth.uid())
 and (not exists(select 1 from public.chat_moderators m where m.user_id=auth.uid()) or private.chat_has_permission('publish_video',auth.uid())));

drop policy if exists video_posts_select on public.video_posts;
create policy video_posts_select on public.video_posts for select to anon,authenticated using(true);
drop policy if exists video_posts_delete_own_or_mod on public.video_posts;
create policy video_posts_delete_own_or_mod on public.video_posts for delete to authenticated using(user_id=auth.uid() or private.chat_can_moderate('delete_messages',user_id));

-- Lock down RPC execution explicitly.
revoke all on function public.chat_my_permissions(), public.chat_role_badges(uuid[]), public.chat_admin_search_users(text), public.chat_admin_list_moderators(),
 public.chat_admin_set_moderator(text,boolean,jsonb,integer,boolean), public.chat_admin_user_panel(uuid),
 public.chat_admin_user_messages(uuid,text), public.chat_admin_user_sanctions(uuid),
 public.chat_moderation_action(text,uuid,text,text,bigint), public.chat_report_message(bigint,text),
 public.chat_mark_warnings_seen(), public.chat_get_warning_threshold(), public.chat_admin_update_settings(integer), public.chat_admin_get_settings(),
 public.chat_admin_list_reports(), public.chat_admin_resolve_report(uuid,text) from public, anon;
grant execute on function public.chat_my_permissions(), public.chat_role_badges(uuid[]), public.chat_admin_search_users(text), public.chat_admin_list_moderators(),
 public.chat_admin_set_moderator(text,boolean,jsonb,integer,boolean), public.chat_admin_user_panel(uuid),
 public.chat_admin_user_messages(uuid,text), public.chat_admin_user_sanctions(uuid),
 public.chat_moderation_action(text,uuid,text,text,bigint), public.chat_report_message(bigint,text),
 public.chat_mark_warnings_seen(), public.chat_get_warning_threshold(), public.chat_admin_update_settings(integer), public.chat_admin_get_settings(),
 public.chat_admin_list_reports(), public.chat_admin_resolve_report(uuid,text) to authenticated;

grant select on public.chat_moderators, public.chat_warnings, public.chat_mutes, public.chat_reports,
 public.chat_moderation_settings, public.chat_bans, public.chat_moderation_logs to authenticated;
grant update(seen) on public.chat_warnings to authenticated;

commit;
