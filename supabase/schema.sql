-- lifeOS keeps each person's Craft API connections here, so every hub app can
-- reach Craft after one setup instead of pasting the URLs on each device.
-- The URL is write access to that Craft space, so rows are private to their
-- owner and never leave the signed-in session.

create table if not exists craft_links (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  space      text not null check (space in ('my', 'work')),
  url        text not null,
  api_key    text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, space)
);

alter table craft_links enable row level security;

drop policy if exists "own rows: read"   on craft_links;
drop policy if exists "own rows: insert" on craft_links;
drop policy if exists "own rows: update" on craft_links;
drop policy if exists "own rows: delete" on craft_links;
create policy "own rows: read"   on craft_links for select using (auth.uid() = user_id);
create policy "own rows: insert" on craft_links for insert with check (auth.uid() = user_id);
create policy "own rows: update" on craft_links for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows: delete" on craft_links for delete using (auth.uid() = user_id);
