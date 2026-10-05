-- Comms area: who can read why a discussion post was hidden.
--
-- hide_discussion_post() stores the moderator (hidden_by) and the reason
-- (hidden_reason) on the post. The topic view (comms_topic_posts) returns the reason
-- only to the topic's moderators and the post's author, but the blanket
-- "grant select on all tables" from 0200 let every reader of a topic select those two
-- columns directly. Readers keep every other column; RLS (posts_select) still decides
-- which rows they see. The definer functions are unaffected.
--
-- Safe to re-apply.

revoke select on public.discussion_posts from authenticated;
grant select (id, topic_id, parent_id, author_id, body_html, created_at, edited_at, hidden_at)
  on public.discussion_posts to authenticated;
