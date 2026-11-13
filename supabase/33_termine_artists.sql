-- 33: Termine mit mehreren Artists (14.11.2026)
-- Artist darf Termine lesen, bei denen er in 'artists' steht (nur lesen).

drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col not in ('gigfin','mwfin','contacts','expenses','asks'))
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben'
         or (data->>'status' in ('Reserviert','Platziert','Duo') and (data->>'reservedFor' = my_person() or data->>'reservedFor2' = my_person()))
         or (data->>'status' = 'Auswahl' and coalesce(data->'candidates','[]'::jsonb) ? my_person())))
    or (col = 'interest')
    or (col = 'notes' and (coalesce(data->'to','[]'::jsonb) ? my_person() or data->>'fromArtist' = my_person()))
    or (col not in ('people','beats','sessions','interest','notes','gigfin','contacts','expenses') and doc_artist(col, data) = my_person())
    or (col = 'gigs' and data->>'req' = 'ok')
    or (col = 'studio' and coalesce(data->'guests','[]'::jsonb) ? my_person())
    or (col = 'todos' and data->>'kind' = 'Termin' and coalesce(data->'artists','[]'::jsonb) ? my_person())
    or (col = 'gigfin' and public.gig_involves(id, my_person()))
    or (col = 'chat' and data->>'ref' like 'gig:%' and public.gig_has_co(split_part(data->>'ref', ':', 2), my_person()))
  ))
);


select 'ok' as stand;
