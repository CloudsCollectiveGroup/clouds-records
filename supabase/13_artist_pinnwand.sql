-- 13: Pinnwand für Artists – Nachrichten zwischen Team und Artist
-- Artist liest Nachrichten an sich (Personen-ID steht in "to") und eigene gesendete (fromArtist),
-- darf Nachrichten ans Team schreiben, an ihn gerichtete als erledigt markieren und eigene zurückziehen.
-- Musikvideo und Kooperation liegen am Release selbst und brauchen keine neue Regel.

drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() in ('team','producer')
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben'
         or (data->>'status' in ('Reserviert','Platziert','Duo') and (data->>'reservedFor' = my_person() or data->>'reservedFor2' = my_person()))
         or (data->>'status' = 'Auswahl' and coalesce(data->'candidates','[]'::jsonb) ? my_person())))
    or (col = 'interest')
    or (col = 'notes' and (coalesce(data->'to','[]'::jsonb) ? my_person() or data->>'fromArtist' = my_person()))
    or (col not in ('people','beats','sessions','interest','notes') and doc_artist(col, data) = my_person())
  ))
);

drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','studio','interest','recordings') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person() and data->>'fromId' = auth.uid()::text)
);

drop policy if exists "ändern" on public.docs;
create policy "ändern" on public.docs for update to authenticated
  using (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()))
  with check (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings') and doc_artist(col, data) = my_person())
    or (my_role() = 'artist' and col = 'notes' and coalesce(data->'to','[]'::jsonb) ? my_person()));

drop policy if exists "löschen" on public.docs;
create policy "löschen" on public.docs for delete to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col = 'comments' and data->>'author' = auth.uid()::text)
  or (my_role() = 'artist' and col in ('interest','recordings') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person())
);
select 'ok' as stand;
