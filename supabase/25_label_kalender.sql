-- 25: Label-Kalender – vom Team freigegebene Releases (data.shareCal = true) sehen alle Artists,
-- aber nur Datum, Artist und Titel. Die Release-Datensätze selbst bleiben für fremde Artists gesperrt.
create or replace function public.label_releases()
returns table(artist text, name text, title text, date text)
language sql stable security definer set search_path = public as $$
  select r.data->>'artist', p.data->>'name', r.data->>'title', r.data->>'date'
  from docs r left join docs p on p.col = 'people' and p.id = r.data->>'artist'
  where r.col = 'releases' and (r.data->>'shareCal')::boolean is true and coalesce(r.data->>'date','') <> ''
    and public.my_role() in ('team','producer','artist')
  order by r.data->>'date'
$$;
revoke execute on function public.label_releases() from public, anon;
grant execute on function public.label_releases() to authenticated;
select 'ok' as stand;
