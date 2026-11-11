-- 09: Recordings – Aufnahmen pro Artist, die noch keinem Release zugeordnet sind
create or replace function public.doc_artist(p_col text, p_data jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'people'   then null
    when p_col in ('releases','tasks','content','studio','interest','recordings') then p_data->>'artist'
    when p_col = 'tracks'   then (select r.data->>'artist' from docs r where r.col='releases' and r.id = p_data->>'release')
    when p_col in ('versions','comments') then (
      select r.data->>'artist' from docs t join docs r on r.col='releases' and r.id = t.data->>'release'
      where t.col='tracks' and t.id = p_data->>'track')
  end $$;

drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','studio','interest','recordings') and doc_artist(col, data) = my_person())
);

drop policy if exists "ändern" on public.docs;
create policy "ändern" on public.docs for update to authenticated
  using (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings') and doc_artist(col, data) = my_person()))
  with check (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','recordings') and doc_artist(col, data) = my_person()));

drop policy if exists "löschen" on public.docs;
create policy "löschen" on public.docs for delete to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col = 'comments' and data->>'author' = auth.uid()::text)
  or (my_role() = 'artist' and col in ('interest','recordings') and doc_artist(col, data) = my_person())
);
select 'ok' as stand;
