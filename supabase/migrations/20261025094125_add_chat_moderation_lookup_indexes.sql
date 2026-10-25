create index if not exists chat_messages_user_id_idx on public.chat_messages (user_id);
create index if not exists chat_bans_banned_by_idx on public.chat_bans (banned_by);
create index if not exists chat_moderation_logs_actor_user_id_idx on public.chat_moderation_logs (actor_user_id);
create index if not exists chat_moderation_logs_target_user_id_idx on public.chat_moderation_logs (target_user_id);
