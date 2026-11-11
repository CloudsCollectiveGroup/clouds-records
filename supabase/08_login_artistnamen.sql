-- 08: Login-Zuordnung über Künstlernamen
-- Benutzername (Teil vor @team.cloudsrecords.de) wird gegen people.id ODER
-- den Künstlernamen (ohne Leerzeichen, klein) gematcht.
-- Beispiel: neira@… → Person "sarah" (Name "Neira") → Rolle artist.

create or replace function public.assign_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text := lower(split_part(new.email,'@',1)); pid text; prole text;
begin
  select id, data->>'role' into pid, prole from docs
   where col='people' and (id = uname or lower(replace(data->>'name',' ','')) = uname) limit 1;
  if prole in ('Artist','Produzent') then
    insert into members (user_id, username, role, person)
    values (new.id, uname, case when prole='Artist' then 'artist' else 'producer' end, pid)
    on conflict (user_id) do nothing;
  elsif exists (select 1 from team_allow where username = uname) then
    insert into members (user_id, username, role, person) values (new.id, uname, 'team', null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

-- Stand 11.11.2026: alle 10 Konten angelegt und geprüft
-- team:     cem, kasper, nikolina, torben
-- producer: anvmal (anuj)
-- artist:   neira (sarah), hakuna, mahirnwt (mahir), ria (aije), 107amir (amir)
