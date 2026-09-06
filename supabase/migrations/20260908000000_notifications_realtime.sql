-- The bell listens to its own notifications over Realtime (components/unread-badge.tsx).
--
-- Replica identity full: the unnotify_* triggers delete a notification when the
-- like, follow or repeel behind it is undone, and a DELETE event carries only
-- the primary key unless the old row is logged whole. Realtime's
-- `user_id=eq.<viewer>` filter cannot match a payload without a user_id, so
-- without this the badge could only ever go up on its own. The rows are short
-- and the table is small; the extra WAL is nothing.
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;
