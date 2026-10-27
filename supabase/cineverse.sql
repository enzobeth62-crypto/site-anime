-- CinéVerse: catalogue public, publication réservée à l’administrateur confirmé.
-- À exécuter dans Supabase SQL Editor après sauvegarde habituelle du schéma.
begin;

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;

create or replace function private.cineverse_is_admin()
returns boolean
language sql stable security definer
set search_path=''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and lower(u.email) = 'bhadenzo28@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function private.cineverse_is_admin() from public,anon;
grant execute on function private.cineverse_is_admin() to authenticated;

create or replace function public.cineverse_is_admin()
returns boolean
language sql stable security definer
set search_path=''
as $$ select auth.uid() is not null and private.cineverse_is_admin(); $$;
revoke all on function public.cineverse_is_admin() from public;
grant execute on function public.cineverse_is_admin() to anon,authenticated;

create table if not exists public.cineverse_animes (
  id uuid primary key default gen_random_uuid(),
  anilist_id integer unique,
  slug text not null unique,
  title text not null check(char_length(title) between 1 and 180),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  publication_state text not null default 'draft' check(publication_state in ('draft','published')),
  publish_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cineverse_animes_published_idx on public.cineverse_animes(publication_state,publish_at,updated_at desc);

create table if not exists public.cineverse_seasons (
  id uuid primary key default gen_random_uuid(),
  anime_id uuid not null references public.cineverse_animes(id) on delete cascade,
  group_name text not null default 'ANIME' check(char_length(group_name) between 1 and 80),
  title text not null check(char_length(title) between 1 and 120),
  description text not null default '',
  card_image_url text,
  sort_order integer not null default 0,
  publication_state text not null default 'published' check(publication_state in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cineverse_seasons_anime_order_idx on public.cineverse_seasons(anime_id,sort_order,created_at);

create table if not exists public.cineverse_episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.cineverse_seasons(id) on delete cascade,
  episode_number numeric(7,2) not null check(episode_number>0),
  title text not null default '',
  thumbnail_url text,
  duration_minutes integer check(duration_minutes is null or duration_minutes between 1 and 600),
  language_version text not null default 'VOSTFR' check(char_length(language_version) between 1 and 30),
  sort_order integer not null default 0,
  publication_state text not null default 'published' check(publication_state in ('draft','published')),
  publish_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(season_id,episode_number,language_version)
);
create index if not exists cineverse_episodes_season_idx on public.cineverse_episodes(season_id,sort_order,episode_number);

create table if not exists public.cineverse_episode_sources (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.cineverse_episodes(id) on delete cascade,
  label text not null default 'Lecteur 1' check(char_length(label) between 1 and 60),
  source_type text not null check(source_type in ('mp4','hls','youtube','vimeo','embed','external')),
  source_url text not null check(char_length(source_url) between 8 and 2000 and source_url ~* '^https://'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cineverse_sources_episode_idx on public.cineverse_episode_sources(episode_id,sort_order);

create table if not exists public.cineverse_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  episode_id uuid not null references public.cineverse_episodes(id) on delete cascade,
  position_seconds integer not null default 0 check(position_seconds>=0),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(user_id,episode_id)
);
create index if not exists cineverse_progress_user_updated_idx on public.cineverse_progress(user_id,updated_at desc);

create table if not exists public.cineverse_comments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.cineverse_episodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check(char_length(display_name) between 1 and 60),
  content text not null check(char_length(content) between 1 and 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists cineverse_comments_episode_idx on public.cineverse_comments(episode_id,created_at) where deleted_at is null;

create table if not exists public.cineverse_reports (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid references public.cineverse_episodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check(reason in ('Lien mort','Mauvais épisode','Problème de lecture','Retrait de contenu','Autre')),
  details text not null default '' check(char_length(details)<=1000),
  status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cineverse_reports_open_idx on public.cineverse_reports(status,created_at desc);

create or replace function private.cineverse_touch_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists cineverse_animes_touch on public.cineverse_animes;
create trigger cineverse_animes_touch before update on public.cineverse_animes for each row execute function private.cineverse_touch_updated_at();
drop trigger if exists cineverse_seasons_touch on public.cineverse_seasons;
create trigger cineverse_seasons_touch before update on public.cineverse_seasons for each row execute function private.cineverse_touch_updated_at();
drop trigger if exists cineverse_episodes_touch on public.cineverse_episodes;
create trigger cineverse_episodes_touch before update on public.cineverse_episodes for each row execute function private.cineverse_touch_updated_at();
drop trigger if exists cineverse_comments_touch on public.cineverse_comments;
create trigger cineverse_comments_touch before update on public.cineverse_comments for each row execute function private.cineverse_touch_updated_at();
drop trigger if exists cineverse_progress_touch on public.cineverse_progress;
create trigger cineverse_progress_touch before update on public.cineverse_progress for each row execute function private.cineverse_touch_updated_at();

alter table public.cineverse_animes enable row level security;
alter table public.cineverse_seasons enable row level security;
alter table public.cineverse_episodes enable row level security;
alter table public.cineverse_episode_sources enable row level security;
alter table public.cineverse_progress enable row level security;
alter table public.cineverse_comments enable row level security;
alter table public.cineverse_reports enable row level security;

drop policy if exists cineverse_animes_read on public.cineverse_animes;
create policy cineverse_animes_read on public.cineverse_animes for select to anon,authenticated
using((publication_state='published' and (publish_at is null or publish_at<=now())) or public.cineverse_is_admin());
drop policy if exists cineverse_animes_admin_insert on public.cineverse_animes;
create policy cineverse_animes_admin_insert on public.cineverse_animes for insert to authenticated with check(public.cineverse_is_admin() and (created_by is null or created_by=(select auth.uid())));
drop policy if exists cineverse_animes_admin_update on public.cineverse_animes;
create policy cineverse_animes_admin_update on public.cineverse_animes for update to authenticated using(public.cineverse_is_admin()) with check(public.cineverse_is_admin());
drop policy if exists cineverse_animes_admin_delete on public.cineverse_animes;
create policy cineverse_animes_admin_delete on public.cineverse_animes for delete to authenticated using(public.cineverse_is_admin());

drop policy if exists cineverse_seasons_read on public.cineverse_seasons;
create policy cineverse_seasons_read on public.cineverse_seasons for select to anon,authenticated using(
 (publication_state='published' and exists(select 1 from public.cineverse_animes a where a.id=anime_id and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now())))
 or public.cineverse_is_admin()
);
drop policy if exists cineverse_seasons_admin_write on public.cineverse_seasons;
create policy cineverse_seasons_admin_write on public.cineverse_seasons for all to authenticated using(public.cineverse_is_admin()) with check(public.cineverse_is_admin());

drop policy if exists cineverse_episodes_read on public.cineverse_episodes;
create policy cineverse_episodes_read on public.cineverse_episodes for select to anon,authenticated using(
 (publication_state='published' and (publish_at is null or publish_at<=now()) and exists(
   select 1 from public.cineverse_seasons s join public.cineverse_animes a on a.id=s.anime_id
   where s.id=season_id and s.publication_state='published' and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now())
 )) or public.cineverse_is_admin()
);
drop policy if exists cineverse_episodes_admin_write on public.cineverse_episodes;
create policy cineverse_episodes_admin_write on public.cineverse_episodes for all to authenticated using(public.cineverse_is_admin()) with check(public.cineverse_is_admin());

drop policy if exists cineverse_sources_read on public.cineverse_episode_sources;
create policy cineverse_sources_read on public.cineverse_episode_sources for select to anon,authenticated using(
 exists(select 1 from public.cineverse_episodes e join public.cineverse_seasons s on s.id=e.season_id join public.cineverse_animes a on a.id=s.anime_id
 where e.id=episode_id and e.publication_state='published' and (e.publish_at is null or e.publish_at<=now()) and s.publication_state='published' and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now()))
 or public.cineverse_is_admin()
);
drop policy if exists cineverse_sources_admin_write on public.cineverse_episode_sources;
create policy cineverse_sources_admin_write on public.cineverse_episode_sources for all to authenticated using(public.cineverse_is_admin()) with check(public.cineverse_is_admin());

drop policy if exists cineverse_progress_own on public.cineverse_progress;
create policy cineverse_progress_own on public.cineverse_progress for all to authenticated using(user_id=(select auth.uid())) with check(
 user_id=(select auth.uid()) and (episode_id is null or exists(select 1 from public.cineverse_episodes e join public.cineverse_seasons se on se.id=e.season_id join public.cineverse_animes a on a.id=se.anime_id where e.id=episode_id and e.publication_state='published' and (e.publish_at is null or e.publish_at<=now()) and se.publication_state='published' and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now())))
);

drop policy if exists cineverse_comments_read on public.cineverse_comments;
create policy cineverse_comments_read on public.cineverse_comments for select to anon,authenticated using((deleted_at is null and exists(
 select 1 from public.cineverse_episodes e join public.cineverse_seasons s on s.id=e.season_id join public.cineverse_animes a on a.id=s.anime_id
 where e.id=episode_id and e.publication_state='published' and (e.publish_at is null or e.publish_at<=now()) and s.publication_state='published' and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now())
)) or public.cineverse_is_admin());
drop policy if exists cineverse_comments_insert_own on public.cineverse_comments;
create policy cineverse_comments_insert_own on public.cineverse_comments for insert to authenticated with check(
 user_id=(select auth.uid()) and not exists(select 1 from public.chat_bans b where b.user_id=(select auth.uid()) and (b.expires_at is null or b.expires_at>now()))
 and exists(select 1 from public.cineverse_episodes e join public.cineverse_seasons se on se.id=e.season_id join public.cineverse_animes a on a.id=se.anime_id where e.id=episode_id and e.publication_state='published' and (e.publish_at is null or e.publish_at<=now()) and se.publication_state='published' and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now()))
);
drop policy if exists cineverse_comments_update_own on public.cineverse_comments;
create policy cineverse_comments_update_own on public.cineverse_comments for update to authenticated
using(user_id=(select auth.uid()) and deleted_at is null) with check(user_id=(select auth.uid()));
drop policy if exists cineverse_comments_admin_update on public.cineverse_comments;
create policy cineverse_comments_admin_update on public.cineverse_comments for update to authenticated using(public.cineverse_is_admin()) with check(public.cineverse_is_admin());
drop policy if exists cineverse_comments_delete_own_or_admin on public.cineverse_comments;
create policy cineverse_comments_delete_own_or_admin on public.cineverse_comments for delete to authenticated using(user_id=(select auth.uid()) or public.cineverse_is_admin());

drop policy if exists cineverse_reports_insert_own on public.cineverse_reports;
create policy cineverse_reports_insert_own on public.cineverse_reports for insert to authenticated with check(
 user_id=(select auth.uid()) and (episode_id is null or exists(select 1 from public.cineverse_episodes e join public.cineverse_seasons se on se.id=e.season_id join public.cineverse_animes a on a.id=se.anime_id where e.id=episode_id and e.publication_state='published' and (e.publish_at is null or e.publish_at<=now()) and se.publication_state='published' and a.publication_state='published' and (a.publish_at is null or a.publish_at<=now())))
);
drop policy if exists cineverse_reports_read_own_or_admin on public.cineverse_reports;
create policy cineverse_reports_read_own_or_admin on public.cineverse_reports for select to authenticated using(user_id=(select auth.uid()) or public.cineverse_is_admin());
drop policy if exists cineverse_reports_update_admin on public.cineverse_reports;
create policy cineverse_reports_update_admin on public.cineverse_reports for update to authenticated using(public.cineverse_is_admin()) with check(public.cineverse_is_admin());

grant select on public.cineverse_animes,public.cineverse_seasons,public.cineverse_episodes,public.cineverse_episode_sources,public.cineverse_comments to anon,authenticated;
grant insert,update,delete on public.cineverse_animes,public.cineverse_seasons,public.cineverse_episodes,public.cineverse_episode_sources to authenticated;
grant select,insert,update,delete on public.cineverse_progress to authenticated;
grant insert,update,delete on public.cineverse_comments to authenticated;
grant select,insert,update on public.cineverse_reports to authenticated;


create or replace function private.cineverse_log_comment_moderation()
returns trigger language plpgsql security definer set search_path=''
as $
begin
 if old.deleted_at is null and new.deleted_at is not null and old.user_id is distinct from (select auth.uid()) then
   if not public.cineverse_is_admin() then
     raise exception 'Permission denied' using errcode='42501';
   end if;
   insert into public.chat_moderation_logs(action,actor_user_id,target_user_id,details)
   values('delete_message',(select auth.uid()),old.user_id,
     jsonb_build_object('source','cineverse','comment_id',old.id,'episode_id',old.episode_id,'reason','comment_moderation'));
 end if;
 return new;
end $;
drop trigger if exists cineverse_comments_moderation_log on public.cineverse_comments;
create trigger cineverse_comments_moderation_log
after update of deleted_at on public.cineverse_comments
for each row execute function private.cineverse_log_comment_moderation();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cineverse-media','cineverse-media',true,52428800,array['video/mp4','video/webm','video/ogg','application/vnd.apple.mpegurl','application/x-mpegurl','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cineverse_media_admin_insert on storage.objects;
create policy cineverse_media_admin_insert on storage.objects for insert to authenticated
with check(bucket_id='cineverse-media' and public.cineverse_is_admin() and (storage.foldername(name))[1]='episodes');
drop policy if exists cineverse_media_admin_update on storage.objects;
create policy cineverse_media_admin_update on storage.objects for update to authenticated
using(bucket_id='cineverse-media' and public.cineverse_is_admin()) with check(bucket_id='cineverse-media' and public.cineverse_is_admin());
drop policy if exists cineverse_media_admin_delete on storage.objects;
create policy cineverse_media_admin_delete on storage.objects for delete to authenticated
using(bucket_id='cineverse-media' and public.cineverse_is_admin());

notify pgrst,'reload schema';
commit;
