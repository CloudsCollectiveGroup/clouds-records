-- 26: Mitwirkende pro Release (13.11.2026)
-- 'mwfin' = Kosten der Mitwirkenden pro Release (id = Release-ID, Feld artist): Team liest/schreibt, betroffener Artist liest, Produzent nie.
-- 'contacts' = externe Dienstleister (z. B. Mastering-Engineer): nur Team.
-- Namen/Rollen der Mitwirkenden liegen am Release (Feld mw) und sind für alle sichtbar, die das Release sehen.

create or replace function public.doc_artist(p_col text, p_data jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'people'   then null
    when p_col in ('releases','tasks','content','studio','interest','recordings','chat','profile','gigs','mwfin') then p_data->>'artist'
    when p_col = 'todos' then case when p_data->>'owner' = 'A'
                                     or coalesce(p_data->'helpers','[]'::jsonb) ? 'A'
                                     or coalesce(p_data->'checks','[]'::jsonb) @> '[{"o":"A"}]'::jsonb
                                   then nullif(p_data->>'artist','') end
    when p_col = 'tracks'   then (select r.data->>'artist' from docs r where r.col='releases' and r.id = p_data->>'release')
    when p_col in ('versions','comments') then (
      select r.data->>'artist' from docs t join docs r on r.col='releases' and r.id = t.data->>'release'
      where t.col='tracks' and t.id = p_data->>'track')
  end $$;


drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col not in ('gigfin','mwfin','contacts'))
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben'
         or (data->>'status' in ('Reserviert','Platziert','Duo') and (data->>'reservedFor' = my_person() or data->>'reservedFor2' = my_person()))
         or (data->>'status' = 'Auswahl' and coalesce(data->'candidates','[]'::jsonb) ? my_person())))
    or (col = 'interest')
    or (col = 'notes' and (coalesce(data->'to','[]'::jsonb) ? my_person() or data->>'fromArtist' = my_person()))
    or (col not in ('people','beats','sessions','interest','notes','gigfin','contacts') and doc_artist(col, data) = my_person())
    or (col = 'gigs' and data->>'req' = 'ok')
    or (col = 'gigfin' and public.gig_involves(id, my_person()))
    or (col = 'chat' and data->>'ref' like 'gig:%' and public.gig_has_co(split_part(data->>'ref', ':', 2), my_person()))
  ))
);

drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col not in ('people','gigfin','mwfin','contacts'))
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
    or (my_role() = 'producer' and col not in ('people','gigfin','mwfin','contacts'))
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings','content','profile','todos','gigs') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'gigs' and coalesce(data->'co','[]'::jsonb) ? my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()))
  with check (
    my_role() = 'team'
    or (my_role() = 'producer' and col not in ('people','gigfin','mwfin','contacts'))
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings','content','profile','todos','gigs') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'gigs' and coalesce(data->'co','[]'::jsonb) ? my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()));


drop policy if exists "löschen" on public.docs;
create policy "löschen" on public.docs for delete to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col not in ('people','gigfin','mwfin','contacts'))
  or (my_role() = 'artist' and col = 'comments' and data->>'author' = auth.uid()::text)
  or (my_role() = 'artist' and col in ('interest','recordings') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person())
  or (my_role() = 'artist' and col = 'content' and data->>'byId' = auth.uid()::text and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'chat' and data->>'byId' = auth.uid()::text and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'gigs' and data->>'req' = 'offen' and data->>'byId' = auth.uid()::text and doc_artist(col, data) = my_person())
);


select 'ok' as stand;
