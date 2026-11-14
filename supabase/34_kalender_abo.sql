-- 34: Kalender-Abo (iCal) pro Person (14.11.2026)
-- Geheime Links pro Benutzer. Tabelle ohne Zugriffsregeln = nur über die Funktion cal_link
-- und die Edge Function "ical" (Service-Rolle) erreichbar.
create table if not exists public.cal_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text unique,
  label_token text unique,
  created_at timestamptz not null default now()
);
alter table public.cal_feeds enable row level security;

-- Liefert den Abo-Schlüssel des angemeldeten Benutzers (legt ihn bei Bedarf an).
-- p_scope: 'mine' = eigene Termine · 'label' = ganzer Label-Kalender (nur Cem & Thorben)
-- p_reset: true = neuen Schlüssel erzeugen, der alte Link funktioniert dann nicht mehr
create or replace function public.cal_link(p_scope text, p_reset boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_new text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_tok text;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if not exists (select 1 from members where user_id = v_uid) then raise exception 'Kein Zugang'; end if;
  if p_scope = 'label' and not exists (select 1 from members where user_id = v_uid and role = 'team' and lower(username) in ('cem','torben','thorben','torbi')) then
    raise exception 'Label-Kalender nur für Cem und Thorben'; end if;
  insert into cal_feeds (user_id) values (v_uid) on conflict (user_id) do nothing;
  if p_scope = 'label' then
    update cal_feeds set label_token = v_new where user_id = v_uid and (p_reset or label_token is null);
    select label_token into v_tok from cal_feeds where user_id = v_uid;
  else
    update cal_feeds set token = v_new where user_id = v_uid and (p_reset or token is null);
    select token into v_tok from cal_feeds where user_id = v_uid;
  end if;
  return v_tok;
end $$;
revoke execute on function public.cal_link(text, boolean) from public, anon;
grant execute on function public.cal_link(text, boolean) to authenticated;
select 'ok' as stand;
