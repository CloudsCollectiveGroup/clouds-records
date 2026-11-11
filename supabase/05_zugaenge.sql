-- Zugänge: Artists/Produzent per Personen-Kürzel, Team nur per Freigabeliste, alle anderen ohne Zugang
create table if not exists public.team_allow (username text primary key);
alter table public.team_allow enable row level security;
revoke all on public.team_allow from anon, authenticated;
insert into public.team_allow (username) values ('cem'),('nikolina'),('thorben'),('torbi'),('kacper'),('kasper') on conflict do nothing;

create or replace function public.assign_member() returns trigger language plpgsql security definer set search_path = public as $$
declare uname text := lower(split_part(new.email,'@',1)); prole text;
begin
  select data->>'role' into prole from docs where col='people' and id = uname;
  if prole in ('Artist','Produzent') then
    insert into members (user_id, username, role, person)
    values (new.id, uname, case when prole='Artist' then 'artist' else 'producer' end, uname)
    on conflict (user_id) do nothing;
  elsif exists (select 1 from team_allow where username = uname) then
    insert into members (user_id, username, role, person) values (new.id, uname, 'team', null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

-- Weitere Team-Person freigeben (vor dem Anlegen des Kontos):
-- insert into public.team_allow (username) values ('neuername');
