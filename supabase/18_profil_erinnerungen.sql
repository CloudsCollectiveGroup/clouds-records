-- 18: Artist-Profil selbst pflegen + tägliche Erinnerungen per Push
-- Profil liegt als col = 'profile', id = Artist-ID, data.artist = Artist-ID.
create or replace function public.doc_artist(p_col text, p_data jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'people'   then null
    when p_col in ('releases','tasks','content','studio','interest','recordings','chat','profile') then p_data->>'artist'
    when p_col = 'tracks'   then (select r.data->>'artist' from docs r where r.col='releases' and r.id = p_data->>'release')
    when p_col in ('versions','comments') then (
      select r.data->>'artist' from docs t join docs r on r.col='releases' and r.id = t.data->>'release'
      where t.col='tracks' and t.id = p_data->>'track')
  end $$;

drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','studio','interest','recordings','content','profile') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'chat' and doc_artist(col, data) = my_person() and data->>'byId' = auth.uid()::text)
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person() and data->>'fromId' = auth.uid()::text)
);

drop policy if exists "ändern" on public.docs;
create policy "ändern" on public.docs for update to authenticated
  using (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings','content','profile') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()))
  with check (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings','content','profile') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()));

-- Erinnerungen: jeden Morgen 7:00 UTC (8:00 Winterzeit / 9:00 Sommerzeit in Hamburg)
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'clouds-erinnerungen';
select cron.schedule('clouds-erinnerungen', '0 7 * * *', $cron$
  select net.http_post(
    url := 'https://nucdwotzhdtyzijempml.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-push-secret', (select v from public.push_config where k = 'secret'),
      'Authorization', 'Bearer ' || (select v from public.push_config where k = 'anon')),
    body := '{"op":"CRON"}'::jsonb);
$cron$);
select 'ok' as stand;
