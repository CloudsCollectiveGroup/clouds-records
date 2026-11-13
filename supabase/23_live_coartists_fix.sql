-- 23 (ersetzt 22): Live – Co-Artists (Feature, Backups) pro Auftritt: data.co = ['mahir', …], data.coRole = {mahir: 'Feature · Backups'}
-- Co-Artists sehen und pflegen den Auftritt mit und schreiben im Chat dazu. Gage ('gigfin') bleibt nur fürs Team.

-- Fix: Unterabfrage auf docs innerhalb der docs-Regel führt zu Rekursion → Prüfung als security-definer-Funktion
create or replace function public.gig_has_co(p_gid text, p_person text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from docs g where g.col = 'gigs' and g.id = p_gid and coalesce(g.data->'co','[]'::jsonb) ? p_person)
$$;
revoke execute on function public.gig_has_co(text, text) from public, anon;
grant execute on function public.gig_has_co(text, text) to authenticated;

drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'gigfin')
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben'
         or (data->>'status' in ('Reserviert','Platziert','Duo') and (data->>'reservedFor' = my_person() or data->>'reservedFor2' = my_person()))
         or (data->>'status' = 'Auswahl' and coalesce(data->'candidates','[]'::jsonb) ? my_person())))
    or (col = 'interest')
    or (col = 'notes' and (coalesce(data->'to','[]'::jsonb) ? my_person() or data->>'fromArtist' = my_person()))
    or (col not in ('people','beats','sessions','interest','notes','gigfin') and doc_artist(col, data) = my_person())
    or (col = 'gigs' and coalesce(data->'co','[]'::jsonb) ? my_person())
    or (col = 'chat' and data->>'ref' like 'gig:%' and public.gig_has_co(split_part(data->>'ref', ':', 2), my_person()))
  ))
);

drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col not in ('people','gigfin'))
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','studio','interest','recordings','content','profile') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'gigs' and doc_artist(col, data) = my_person() and data->>'req' = 'offen' and data->>'byId' = auth.uid()::text)
  or (my_role() = 'artist' and col = 'chat' and doc_artist(col, data) = my_person() and data->>'byId' = auth.uid()::text)
  or (my_role() = 'artist' and col = 'chat' and data->>'byId' = auth.uid()::text and data->>'ref' like 'gig:%' and public.gig_has_co(split_part(data->>'ref', ':', 2), my_person()))
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person() and data->>'fromId' = auth.uid()::text)
);

drop policy if exists "ändern" on public.docs;
create policy "ändern" on public.docs for update to authenticated
  using (
    my_role() = 'team'
    or (my_role() = 'producer' and col not in ('people','gigfin'))
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings','content','profile','todos','gigs') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'gigs' and coalesce(data->'co','[]'::jsonb) ? my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()))
  with check (
    my_role() = 'team'
    or (my_role() = 'producer' and col not in ('people','gigfin'))
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings','content','profile','todos','gigs') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'gigs' and coalesce(data->'co','[]'::jsonb) ? my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()));

select 'ok' as stand;
