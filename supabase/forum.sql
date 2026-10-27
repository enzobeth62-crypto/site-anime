-- Animeverse forum schema and policies.
-- Run supabase/chat_admin_permissions.sql first: forum moderation reuses its chat role permissions and safe chat_moderation_action RPC.
begin;

do $$ begin
  if to_regprocedure('private.chat_cannot_send(uuid)') is null
     or to_regprocedure('private.chat_has_permission(text,uuid)') is null
     or to_regprocedure('private.chat_can_moderate(text,uuid)') is null
     or to_regprocedure('public.chat_moderation_action(text,uuid,text,text,bigint)') is null then
    raise exception 'Run chat_admin_permissions.sql before forum.sql';
  end if;
end $$;

create table if not exists public.forum_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 2 and 40),
  description text not null default '',
  icon text not null default 'chat',
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
insert into public.forum_categories(slug,name,description,icon,display_order) values
 ('discussion','Discussion','Discussions générales autour des anime.','chat',1),
 ('recommandations','Recommandations','Partage tes découvertes et demande des conseils.','sparkles',2),
 ('theories','Théories','Analyse les histoires et partage tes théories.','lightbulb',3),
 ('actualites','Actualités','Parle des annonces et sorties du monde anime.','news',4),
 ('aide','Aide','Pose tes questions et aide les autres membres.','help',5)
on conflict(slug) do update set name=excluded.name,description=excluded.description,icon=excluded.icon,display_order=excluded.display_order;

create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_display_name text not null check(char_length(author_display_name) between 1 and 50),
  title text not null check(char_length(title) between 5 and 160),
  category_id uuid not null references public.forum_categories(id),
  tags text[] not null default '{}',
  pinned boolean not null default false,
  locked boolean not null default false,
  views integer not null default 0 check(views>=0),
  last_post_id uuid,
  last_post_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists forum_threads_recent_idx on public.forum_threads(pinned desc,last_post_at desc) where deleted_at is null;
create index if not exists forum_threads_category_recent_idx on public.forum_threads(category_id,last_post_at desc) where deleted_at is null;
create index if not exists forum_threads_author_idx on public.forum_threads(author_id,created_at desc);

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_display_name text not null check(char_length(author_display_name) between 1 and 50),
  content text not null check(char_length(content) between 1 and 6000),
  quote_post_id uuid references public.forum_posts(id) on delete set null,
  attachments jsonb not null default '[]'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_posts_attachments_array check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=4)
);
create index if not exists forum_posts_thread_created_idx on public.forum_posts(thread_id,created_at);
create index if not exists forum_posts_author_created_idx on public.forum_posts(author_id,created_at desc);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='forum_threads_last_post_id_fkey' and conrelid='public.forum_threads'::regclass) then
   alter table public.forum_threads add constraint forum_threads_last_post_id_fkey foreign key(last_post_id) references public.forum_posts(id) on delete set null;
 end if;
end $$;

create table if not exists public.forum_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.forum_threads(id) on delete cascade,
  post_id uuid references public.forum_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint forum_likes_one_target check((thread_id is not null)::integer+(post_id is not null)::integer=1)
);
create unique index if not exists forum_likes_thread_user_uidx on public.forum_likes(thread_id,user_id) where thread_id is not null;
create unique index if not exists forum_likes_post_user_uidx on public.forum_likes(post_id,user_id) where post_id is not null;
create index if not exists forum_likes_thread_idx on public.forum_likes(thread_id) where thread_id is not null;
create index if not exists forum_likes_post_idx on public.forum_likes(post_id) where post_id is not null;

create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  post_id uuid references public.forum_posts(id) on delete cascade,
  notification_type text not null check(notification_type in ('thread_reply','post_reply')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists forum_notifications_user_created_idx on public.forum_notifications(user_id,created_at desc) where read_at is null;

create or replace function private.forum_valid_attachments(p_attachments jsonb,p_uid uuid)
returns boolean language plpgsql immutable security definer set search_path=''
as $$
declare item jsonb; v_type text; v_path text; v_url text;
begin
 if jsonb_typeof(p_attachments)<>'array' or jsonb_array_length(p_attachments)>4 then return false; end if;
 for item in select value from jsonb_array_elements(p_attachments) loop
  v_type:=item->>'type';
  if v_type='image' then
   v_path:=item->>'path';
   if v_path is null or left(v_path,char_length(p_uid::text)+1)<>p_uid::text||'/' or v_path !~* '\.(webp|png|jpe?g)$' then return false; end if;
  elsif v_type='anime' then
   if coalesce(item->>'anilist_id','') !~ '^[0-9]{1,10}$' or char_length(coalesce(item->>'title','')) not between 1 and 160 or coalesce(item->>'cover_url','') !~* '^https://(.*\.)?anilist\.co/.*' then return false; end if;
  elsif v_type='video' then
   v_url:=item->>'url';
   if v_url is null or v_url !~* '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/' then return false; end if;
  else return false;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create or replace function private.forum_touch_thread()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_thread public.forum_threads%rowtype; v_quote_author uuid;
begin
 update public.forum_threads set last_post_id=new.id,last_post_at=new.created_at,updated_at=now()
 where id=new.thread_id returning * into v_thread;
 if v_thread.author_id is not null and v_thread.author_id<>new.author_id then
   insert into public.forum_notifications(user_id,actor_id,thread_id,post_id,notification_type)
   values(v_thread.author_id,new.author_id,new.thread_id,new.id,'thread_reply');
 end if;
 if new.quote_post_id is not null then
   select author_id into v_quote_author from public.forum_posts where id=new.quote_post_id;
   if v_quote_author is not null and v_quote_author<>new.author_id and v_quote_author<>v_thread.author_id then
     insert into public.forum_notifications(user_id,actor_id,thread_id,post_id,notification_type)
     values(v_quote_author,new.author_id,new.thread_id,new.id,'post_reply');
   end if;
 end if;
 return new;
end $$;
drop trigger if exists forum_post_insert_touch_thread on public.forum_posts;
create trigger forum_post_insert_touch_thread after insert on public.forum_posts for each row execute function private.forum_touch_thread();

create or replace function private.forum_touch_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); if tg_table_name='forum_posts' then if old.content is distinct from new.content then new.edited_at=now(); end if; end if; return new; end $$;
drop trigger if exists forum_threads_updated_at on public.forum_threads;
create trigger forum_threads_updated_at before update on public.forum_threads for each row execute function private.forum_touch_updated_at();
drop trigger if exists forum_posts_updated_at on public.forum_posts;
create trigger forum_posts_updated_at before update on public.forum_posts for each row execute function private.forum_touch_updated_at();

create or replace function public.forum_create_thread(p_title text,p_category_id uuid,p_tags text[],p_content text,p_attachments jsonb,p_author_display_name text)
returns uuid language plpgsql security definer set search_path=''
as $create_thread$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if private.chat_cannot_send(auth.uid()) then raise exception 'Account restricted' using errcode='42501'; end if;
 if char_length(trim(coalesce(p_title,''))) not between 5 and 160 or char_length(trim(coalesce(p_content,''))) not between 1 and 6000 then raise exception 'Invalid topic'; end if;
 if not exists(select 1 from public.forum_categories where id=p_category_id) then raise exception 'Invalid category'; end if;
 if coalesce(array_length(p_tags,1),0)>8 then raise exception 'Too many tags'; end if;
 if not private.forum_valid_attachments(coalesce(p_attachments,'[]'::jsonb),auth.uid()) then raise exception 'Invalid attachments'; end if;
 insert into public.forum_threads(author_id,author_display_name,title,category_id,tags)
 values(auth.uid(),left(coalesce(nullif(trim(p_author_display_name),''),'Membre'),50),trim(p_title),p_category_id,coalesce(p_tags,'{}'))
 returning id into v_id;
 insert into public.forum_posts(thread_id,author_id,author_display_name,content,attachments)
 values(v_id,auth.uid(),left(coalesce(nullif(trim(p_author_display_name),''),'Membre'),50),trim(p_content),coalesce(p_attachments,'[]'::jsonb));
 return v_id;
end $create_thread$;

create or replace function public.forum_get_like_counts(p_thread_ids uuid[] default '{}',p_post_ids uuid[] default '{}')
returns table(target_type text,target_id uuid,like_count bigint,liked boolean)
language plpgsql stable security definer set search_path=''
as $likes$
begin
 return query
 select 'thread'::text,t.id,count(l.id)::bigint,coalesce(bool_or(l.user_id=auth.uid()),false)
 from public.forum_threads t left join public.forum_likes l on l.thread_id=t.id
 where t.id=any(coalesce(p_thread_ids,'{}'::uuid[])) and t.deleted_at is null group by t.id
 union all
 select 'post'::text,p.id,count(l.id)::bigint,coalesce(bool_or(l.user_id=auth.uid()),false)
 from public.forum_posts p join public.forum_threads t on t.id=p.thread_id
 left join public.forum_likes l on l.post_id=p.id
 where p.id=any(coalesce(p_post_ids,'{}'::uuid[])) and t.deleted_at is null and p.deleted_at is null group by p.id;
end $likes$;

create or replace function public.forum_moderate_post(p_post_id uuid,p_action text)
returns void language plpgsql security definer set search_path=''
as $moderate_post$
declare v_author uuid;v_thread uuid;v_content text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select author_id,thread_id,content into v_author,v_thread,v_content from public.forum_posts where id=p_post_id and deleted_at is null for update;
 if not found then raise exception 'Post not found'; end if;
 if p_action<>'delete' or not private.chat_has_permission('manage_forum',auth.uid()) or (not private.chat_is_super_admin(auth.uid()) and (private.chat_is_super_admin(v_author) or exists(select 1 from public.chat_moderators where user_id=v_author))) then raise exception 'Permission denied' using errcode='42501'; end if;
 update public.forum_posts set content='Ce message a été supprimé par la modération.',attachments='[]'::jsonb,deleted_at=now() where id=p_post_id;
 insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details)
 values('forum_delete',auth.uid(),v_author,jsonb_build_object('post_id',p_post_id,'thread_id',v_thread));
end $moderate_post$;

create or replace function public.forum_increment_view(p_thread_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_views integer;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 update public.forum_threads set views=views+1 where id=p_thread_id and deleted_at is null returning views into v_views;
 if v_views is null then raise exception 'Sujet introuvable'; end if;
 return v_views;
end $$;

create or replace function public.forum_moderate_thread(p_thread_id uuid,p_action text,p_category_id uuid default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_author uuid; v_title text; v_log_action text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select author_id,title into v_author,v_title from public.forum_threads where id=p_thread_id and deleted_at is null for update;
 if not found then raise exception 'Sujet introuvable'; end if;
 if not private.chat_has_permission('manage_forum',auth.uid()) or (not private.chat_is_super_admin(auth.uid()) and (private.chat_is_super_admin(v_author) or exists(select 1 from public.chat_moderators where user_id=v_author))) then raise exception 'Permission insuffisante' using errcode='42501'; end if;
 if p_action='pin' then update public.forum_threads set pinned=not pinned,updated_at=now() where id=p_thread_id;v_log_action='forum_pin';
 elsif p_action='lock' then update public.forum_threads set locked=not locked,updated_at=now() where id=p_thread_id;v_log_action='forum_lock';
 elsif p_action='move' then
   if p_category_id is null or not exists(select 1 from public.forum_categories where id=p_category_id) then raise exception 'Catégorie invalide'; end if;
   update public.forum_threads set category_id=p_category_id,updated_at=now() where id=p_thread_id;v_log_action='forum_move';
 elsif p_action='delete' then update public.forum_threads set deleted_at=now(),updated_at=now() where id=p_thread_id;v_log_action='forum_delete';
 else raise exception 'Action inconnue';
 end if;
 insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details)
 values(v_log_action,auth.uid(),v_author,jsonb_build_object('thread_id',p_thread_id,'title',v_title,'category_id',p_category_id));
end $$;

alter table public.forum_categories enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;
alter table public.forum_likes enable row level security;
alter table public.forum_notifications enable row level security;

drop policy if exists forum_categories_read on public.forum_categories;
create policy forum_categories_read on public.forum_categories for select to anon,authenticated using(true);

drop policy if exists forum_threads_read on public.forum_threads;
create policy forum_threads_read on public.forum_threads for select to anon,authenticated using(deleted_at is null);
drop policy if exists forum_threads_insert_own on public.forum_threads;
create policy forum_threads_insert_own on public.forum_threads for insert to authenticated
 with check(author_id=auth.uid() and not private.chat_cannot_send(auth.uid()));
drop policy if exists forum_threads_update_own on public.forum_threads;
create policy forum_threads_update_own on public.forum_threads for update to authenticated
 using(author_id=auth.uid() and deleted_at is null and not private.chat_cannot_send(auth.uid()))
 with check(author_id=auth.uid() and not private.chat_cannot_send(auth.uid()));

drop policy if exists forum_posts_read_thread on public.forum_posts;
create policy forum_posts_read_thread on public.forum_posts for select to anon,authenticated using(
 exists(select 1 from public.forum_threads t where t.id=thread_id and t.deleted_at is null)
);
drop policy if exists forum_posts_insert_open_thread on public.forum_posts;
create policy forum_posts_insert_open_thread on public.forum_posts for insert to authenticated with check(
 author_id=auth.uid() and not private.chat_cannot_send(auth.uid())
 and private.forum_valid_attachments(attachments,auth.uid()) and (quote_post_id is null or exists(select 1 from public.forum_posts qp where qp.id=quote_post_id and qp.thread_id=thread_id))
 and exists(select 1 from public.forum_threads t where t.id=thread_id and t.deleted_at is null and not t.locked)
);
drop policy if exists forum_posts_update_own on public.forum_posts;
create policy forum_posts_update_own on public.forum_posts for update to authenticated using(
 author_id=auth.uid() and deleted_at is null and not private.chat_cannot_send(auth.uid())
 and exists(select 1 from public.forum_threads t where t.id=thread_id and t.deleted_at is null)
) with check(author_id=auth.uid() and not private.chat_cannot_send(auth.uid()) and private.forum_valid_attachments(attachments,auth.uid()) and (quote_post_id is null or exists(select 1 from public.forum_posts qp where qp.id=quote_post_id and qp.thread_id=thread_id)));

drop policy if exists forum_likes_read on public.forum_likes;
create policy forum_likes_read on public.forum_likes for select to authenticated using(user_id=auth.uid());
drop policy if exists forum_likes_insert_own on public.forum_likes;
create policy forum_likes_insert_own on public.forum_likes for insert to authenticated with check(
 user_id=auth.uid() and not private.chat_cannot_send(auth.uid())
 and ((thread_id is not null and exists(select 1 from public.forum_threads t where t.id=thread_id and t.deleted_at is null))
   or (post_id is not null and exists(select 1 from public.forum_posts p join public.forum_threads t on t.id=p.thread_id where p.id=post_id and t.deleted_at is null)))
);
drop policy if exists forum_likes_delete_own on public.forum_likes;
create policy forum_likes_delete_own on public.forum_likes for delete to authenticated using(user_id=auth.uid());

drop policy if exists forum_notifications_read_own on public.forum_notifications;
create policy forum_notifications_read_own on public.forum_notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists forum_notifications_update_own on public.forum_notifications;
create policy forum_notifications_update_own on public.forum_notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke insert,delete on public.forum_notifications from anon,authenticated;
grant select on public.forum_categories,public.forum_threads,public.forum_posts to anon,authenticated;
grant select on public.forum_likes to authenticated;
grant select on public.forum_threads,public.forum_posts to authenticated;
revoke insert,update on public.forum_threads,public.forum_posts from authenticated;
grant insert(author_id,author_display_name,title,category_id,tags) on public.forum_threads to authenticated;
grant insert(thread_id,author_id,author_display_name,content,quote_post_id,attachments) on public.forum_posts to authenticated;
grant select,insert,delete on public.forum_likes to authenticated;
grant select on public.forum_notifications to authenticated;
revoke update on public.forum_notifications from authenticated;
grant update(read_at) on public.forum_notifications to authenticated;
grant execute on function private.forum_valid_attachments(jsonb,uuid) to authenticated;
revoke update on public.forum_threads from authenticated;
grant update(title,category_id,tags,deleted_at) on public.forum_threads to authenticated;
revoke update on public.forum_posts from authenticated;
grant update(content,quote_post_id,attachments,deleted_at) on public.forum_posts to authenticated;
grant execute on function public.forum_create_thread(text,uuid,text[],text,jsonb,text),public.forum_increment_view(uuid),public.forum_moderate_thread(uuid,text,uuid),public.forum_moderate_post(uuid,text) to authenticated;
grant execute on function public.forum_get_like_counts(uuid[],uuid[]) to anon,authenticated;
revoke all on function public.forum_create_thread(text,uuid,text[],text,jsonb,text),public.forum_increment_view(uuid),public.forum_moderate_thread(uuid,text,uuid),public.forum_moderate_post(uuid,text) from public,anon;
revoke all on function public.forum_get_like_counts(uuid[],uuid[]) from public;

alter table public.chat_moderation_logs drop constraint if exists chat_moderation_logs_action_check;
alter table public.chat_moderation_logs add constraint chat_moderation_logs_action_check check(action in(
 'delete_message','ban_user','unban_user','update_ban','retention_purge','warn_user','mute_user','unmute_user','report_message','resolve_report',
 'appoint_moderator','remove_moderator','update_moderator_permissions','update_settings','video_published',
 'forum_pin','forum_lock','forum_move','forum_delete'
));

-- Private image storage: authenticated members may read; each user can upload/delete only in their UUID folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('forum-images','forum-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists forum_images_read on storage.objects;
create policy forum_images_read on storage.objects for select to anon,authenticated using(bucket_id='forum-images');
drop policy if exists forum_images_insert_own on storage.objects;
create policy forum_images_insert_own on storage.objects for insert to authenticated with check(bucket_id='forum-images' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists forum_images_delete_own on storage.objects;
create policy forum_images_delete_own on storage.objects for delete to authenticated using(bucket_id='forum-images' and (storage.foldername(name))[1]=auth.uid()::text);

-- Turn on Supabase Realtime for replies in an open topic.
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='forum_posts') then
   alter publication supabase_realtime add table public.forum_posts;
 end if;
end $$;

commit;
