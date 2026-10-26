-- One read policy instead of two (fewer policy evaluations per query),
-- and an index for the submitted_by foreign key.
drop policy "Anyone can read approved events" on public.events;
drop policy "Submitters can read their own events" on public.events;

create policy "Read approved events, or your own submissions"
  on public.events for select
  to anon, authenticated
  using (status = 'approved' or submitted_by = (select auth.uid()));

create index events_submitted_by_idx on public.events (submitted_by);
