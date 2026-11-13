-- 24: Live – alle Artists sehen alle Auftritte (Entscheidung Cem, 13.11.2026).
-- Gage/Budget ('gigfin') sehen nur Team und die Artists, die an diesem Auftritt beteiligt sind (Haupt- und Gast-Artist).
-- Ändern dürfen weiterhin nur Team und Beteiligte. Ausnahme von „Artists sehen sich gegenseitig nicht“ gilt nur für Live.

create or replace function public.gig_involves(p_gid text, p_person text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from docs g where g.col = 'gigs' and g.id = p_gid
                 and (g.data->>'artist' = p_person or coalesce(g.data->'co','[]'::jsonb) ? p_person))
$$;
revoke execute on function public.gig_involves(text, text) from public, anon;
grant execute on function public.gig_involves(text, text) to authenticated;

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
    or (col = 'gigs' and data->>'req' = 'ok')
    or (col = 'gigfin' and public.gig_involves(id, my_person()))
    or (col = 'chat' and data->>'ref' like 'gig:%' and public.gig_has_co(split_part(data->>'ref', ':', 2), my_person()))
  ))
);
select 'ok' as stand;
