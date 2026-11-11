-- 11: Duo / Feature-Idee – ein Beat für zwei Artists; beide sehen ihn
-- (Name des Partners steht am Beat selbst, Vertragsdaten anderer Artists bleiben unsichtbar)
drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() in ('team','producer')
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben'
         or (data->>'status' in ('Reserviert','Platziert','Duo') and (data->>'reservedFor' = my_person() or data->>'reservedFor2' = my_person()))))
    or (col = 'interest')
    or (col not in ('people','beats','sessions','interest') and doc_artist(col, data) = my_person())
  ))
);
select 'ok' as stand;
