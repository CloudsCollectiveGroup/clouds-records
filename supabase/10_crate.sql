-- 10: Clouds Crate – Artists markieren freigegebene Beats, jeder Beat nur einmal
-- Artists dürfen alle Markierungen lesen (Beat-ID, Artist-ID, Künstlername), damit sie sehen, was schon vergeben ist.
drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() in ('team','producer')
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben' or (data->>'status' in ('Reserviert','Platziert') and data->>'reservedFor' = my_person())))
    or (col = 'interest')
    or (col not in ('people','beats','sessions','interest') and doc_artist(col, data) = my_person())
  ))
);

-- Ein Beat kann nur von einem Artist markiert werden (verhindert doppelte Markierung, auch bei gleichzeitigem Tippen)
create unique index if not exists docs_interest_one_per_beat on public.docs ((data->>'beat')) where col = 'interest';
select 'ok' as stand;
