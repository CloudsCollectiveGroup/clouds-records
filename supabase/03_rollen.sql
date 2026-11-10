-- Clouds Records – Phase 2: Rollen. Team sieht alles, Produzent sieht alles (ohne Vertragsdaten zu ändern),
-- Artist sieht nur den eigenen Bereich.
create table if not exists public.members (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  role     text not null check (role in ('team','producer','artist')),
  person   text,              -- id des Personen-Eintrags (z. B. 'sarah'), Pflicht bei artist/producer
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;
revoke all on public.members from anon;

-- Hilfsfunktionen (security definer, damit die Regeln nicht rekursiv werden)
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() $$;
create or replace function public.my_person() returns text language sql stable security definer set search_path = public as $$
  select person from public.members where user_id = auth.uid() $$;
create or replace function public.doc_artist(p_col text, p_data jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'people'   then null
    when p_col in ('releases','tasks') then p_data->>'artist'
    when p_col = 'tracks'   then (select r.data->>'artist' from docs r where r.col='releases' and r.id = p_data->>'release')
    when p_col in ('versions','comments') then (
      select r.data->>'artist' from docs t join docs r on r.col='releases' and r.id = t.data->>'release'
      where t.col='tracks' and t.id = p_data->>'track')
  end $$;
revoke execute on function public.my_role(), public.my_person(), public.doc_artist(text, jsonb) from public, anon;
grant execute on function public.my_role(), public.my_person(), public.doc_artist(text, jsonb) to authenticated;

drop policy if exists "eigene rolle lesen" on public.members;
create policy "eigene rolle lesen" on public.members for select to authenticated
  using (user_id = auth.uid() or my_role() = 'team');

-- Neue Konten automatisch zuordnen: Benutzername = Personen-Kürzel (sarah, hakuna, anuj …) → Artist bzw. Produzent,
-- jeder andere Benutzername → Team. (Konten kann nur der Admin im Supabase-Dashboard anlegen.)
create or replace function public.assign_member() returns trigger language plpgsql security definer set search_path = public as $$
declare uname text := lower(split_part(new.email,'@',1)); prole text;
begin
  select data->>'role' into prole from docs where col='people' and id = uname;
  insert into members (user_id, username, role, person) values (
    new.id, uname,
    case when prole = 'Artist' then 'artist' when prole = 'Produzent' then 'producer' else 'team' end,
    case when prole is not null then uname end)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_member on auth.users;
create trigger on_auth_user_created_member after insert on auth.users for each row execute function public.assign_member();

-- Alte Phase-1-Regeln ersetzen
drop policy if exists "team liest"     on public.docs;
drop policy if exists "team schreibt"  on public.docs;
drop policy if exists "team ändert"    on public.docs;
drop policy if exists "team löscht"    on public.docs;
drop policy if exists "lesen"   on public.docs;
drop policy if exists "anlegen" on public.docs;
drop policy if exists "ändern"  on public.docs;
drop policy if exists "löschen" on public.docs;

-- Lesen: Team + Produzent alles; Artist nur sich selbst, die Produzenten und alles zu den eigenen Releases
create policy "lesen" on public.docs for select to authenticated using (
  my_role() in ('team','producer')
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col <> 'people' and doc_artist(col, data) = my_person())
  ))
);
-- Anlegen/Ändern: Team alles; Produzent alles außer Personen/Verträgen; Artist Aufgaben, Tracks, Versionen, Kommentare im eigenen Bereich
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments') and doc_artist(col, data) = my_person())
);
create policy "ändern" on public.docs for update to authenticated
  using (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments') and doc_artist(col, data) = my_person()))
  with check (
    my_role() = 'team'
    or (my_role() = 'producer' and col <> 'people')
    or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments') and doc_artist(col, data) = my_person()));
-- Löschen: Team alles; Produzent außer Personen; Artist nur eigene Kommentare
create policy "löschen" on public.docs for delete to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col = 'comments' and data->>'author' = auth.uid()::text)
);

-- Live-Abgleich soll ebenfalls nur erlaubte Zeilen liefern (Realtime prüft RLS automatisch)

-- Bestehende Konten eintragen
insert into public.members (user_id, username, role, person)
select id, split_part(email,'@',1), 'team', null from auth.users where email = 'cem@team.cloudsrecords.de'
on conflict (user_id) do update set role = excluded.role;
update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || '{"name":"Cem"}'::jsonb
where email = 'cem@team.cloudsrecords.de';

select m.username, m.role, m.person from public.members m;
