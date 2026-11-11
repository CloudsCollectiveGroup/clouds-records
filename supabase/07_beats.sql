-- Beats, Listening-Sessions, Interesse
create or replace function public.doc_artist(p_col text, p_data jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'people'   then null
    when p_col in ('releases','tasks','content','studio','interest') then p_data->>'artist'
    when p_col = 'tracks'   then (select r.data->>'artist' from docs r where r.col='releases' and r.id = p_data->>'release')
    when p_col in ('versions','comments') then (
      select r.data->>'artist' from docs t join docs r on r.col='releases' and r.id = t.data->>'release'
      where t.col='tracks' and t.id = p_data->>'track')
  end $$;

drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() in ('team','producer')
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben' or (data->>'status' = 'Reserviert' and data->>'reservedFor' = my_person())))
    or (col not in ('people','beats','sessions') and doc_artist(col, data) = my_person())
  ))
);
drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','studio','interest') and doc_artist(col, data) = my_person())
);
drop policy if exists "löschen" on public.docs;
create policy "löschen" on public.docs for delete to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col = 'comments' and data->>'author' = auth.uid()::text)
  or (my_role() = 'artist' and col = 'interest' and doc_artist(col, data) = my_person())
);
select 'ok' as stand;
