-- Adds persistent quick reactions to Animeverse chat.
-- The chat_messages primary key is bigint in this project.
create table if not exists public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🔥')),
  created_at timestamptz not null default now(),
  constraint chat_reactions_message_user_emoji_key unique (message_id,user_id,emoji)
);
create index if not exists chat_reactions_message_id_idx on public.chat_reactions(message_id);
alter table public.chat_reactions enable row level security;
revoke all on public.chat_reactions from anon, public;
grant select,insert,delete on public.chat_reactions to authenticated;
drop policy if exists "Authenticated users can read chat reactions" on public.chat_reactions;
create policy "Authenticated users can read chat reactions" on public.chat_reactions for select to authenticated using (true);
drop policy if exists "Users can add own reactions unless banned" on public.chat_reactions;
create policy "Users can add own reactions unless banned" on public.chat_reactions for insert to authenticated with check (
  user_id = (select auth.uid())
  and not exists (
    select 1 from public.chat_bans b
    where b.user_id = (select auth.uid())
      and (b.expires_at is null or b.expires_at > now())
  )
);
drop policy if exists "Users can remove own reactions" on public.chat_reactions;
create policy "Users can remove own reactions" on public.chat_reactions for delete to authenticated using (user_id = (select auth.uid()));
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_reactions') then
    execute 'alter publication supabase_realtime add table public.chat_reactions';
  end if;
end $$;
