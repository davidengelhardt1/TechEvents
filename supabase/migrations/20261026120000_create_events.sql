-- Tech Event Globe: events, deadlines, row-level security, and a distance query.
-- Public visitors read approved events only. Signed-in users can submit pending events.
-- Approving or rejecting an event is done with the service role (dashboard or ingestion job).

create extension if not exists postgis with schema extensions;

create table public.events (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name          text not null check (char_length(name) between 3 and 200),
  start_date    date not null,
  end_date      date not null,
  city          text not null check (char_length(city) between 1 and 120),
  country       text not null check (char_length(country) between 1 and 120),
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  geog          extensions.geography(Point, 4326) generated always as (
                  extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
                ) stored,
  metro         text not null check (char_length(metro) between 1 and 120),
  categories    text[] not null check (
                  cardinality(categories) between 1 and 8
                  and categories <@ array['cyber','offsec','ai','ml','dev','arch','oss','general']::text[]
                ),
  url           text check (url is null or url ~* '^https?://'),
  kind          text not null default 'listing' check (kind in ('official', 'listing')),
  source        text not null check (char_length(source) between 1 and 300),
  venue         text,
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint events_dates_ok check (end_date >= start_date)
);

comment on table public.events is 'Tech conferences, summits and expos shown on the globe.';
comment on column public.events.metro is 'Groups events in one city area so they cluster together. Use the same string for the same area.';
comment on column public.events.kind is 'official = organizer site, listing = third-party list.';

create index events_start_idx on public.events (start_date) where status = 'approved';
create index events_geog_idx on public.events using gist (geog);
create index events_categories_idx on public.events using gin (categories);

create table public.event_deadlines (
  id             bigint generated always as identity primary key,
  event_id       text not null references public.events (id) on delete cascade,
  type           text not null check (type in ('cfp', 'early')),
  deadline_date  date not null,
  deadline_time  text,
  url            text check (url is null or url ~* '^https?://')
);

comment on table public.event_deadlines is 'Speaker-submission (cfp) and early-bird (early) deadlines. Add only what an official page confirms.';

create index event_deadlines_event_idx on public.event_deadlines (event_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- Row-level security
alter table public.events enable row level security;
alter table public.event_deadlines enable row level security;

create policy "Anyone can read approved events"
  on public.events for select
  to anon, authenticated
  using (status = 'approved');

create policy "Submitters can read their own events"
  on public.events for select
  to authenticated
  using (submitted_by = (select auth.uid()));

create policy "Signed-in users can submit pending events"
  on public.events for insert
  to authenticated
  with check (status = 'pending' and submitted_by = (select auth.uid()));

create policy "Anyone can read deadlines of approved events"
  on public.event_deadlines for select
  to anon, authenticated
  using (exists (
    select 1 from public.events e
    where e.id = event_deadlines.event_id and e.status = 'approved'
  ));

grant select on public.events, public.event_deadlines to anon, authenticated;
grant insert on public.events to authenticated;

-- Approved events within a distance of a point, nearest first. Runs with the caller's rights, so RLS applies.
create function public.events_near(p_lat double precision, p_lng double precision, p_miles double precision)
returns setof public.events
language sql
stable
security invoker
set search_path = ''
as $$
  select e.*
  from public.events e
  where e.status = 'approved'
    and extensions.st_dwithin(
      e.geog,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      p_miles * 1609.344
    )
  order by
    extensions.st_distance(
      e.geog,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
    ),
    e.start_date;
$$;

grant execute on function public.events_near(double precision, double precision, double precision) to anon, authenticated;
