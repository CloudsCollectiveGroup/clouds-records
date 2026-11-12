-- 14: Push-Mitteilungen (Web-Push)
-- Geräte melden sich über push_subscribe() an; ein Trigger auf docs ruft bei neuen Nachrichten,
-- Studio-Anfragen/-Bestätigungen und zugewiesenen Aufgaben die Edge Function "push" auf.
-- Schlüssel: Secret wird hier zufällig erzeugt, das VAPID-Paar erzeugt die Edge Function beim ersten Aufruf (?init).
-- Nichts davon steht im Repo.
create extension if not exists pg_net;

create table if not exists public.push_config (k text primary key, v text not null);
alter table public.push_config enable row level security;   -- keine Regeln: nur Service-Rolle/SQL-Editor
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (k, v) values ('secret', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (k) do nothing;
insert into public.push_config (k, v) values ('anon', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51Y2R3b3R6aGR0eXppamVtcG1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzMTc2ODQsImV4cCI6MjEwOTg5MzY4NH0.k4qhCKmdQLjhmbkc6TLlSBYWWtszW41BuGZJeAYP6p4') on conflict (k) do nothing;
-- Öffentlicher Schlüssel für die App (der private bleibt in der Tabelle)
create or replace function public.push_public_key() returns text language sql stable security definer set search_path = public as $$
  select v from push_config where k = 'vapid_public' $$;
grant execute on function public.push_public_key() to authenticated;

create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  sub        jsonb not null,
  ua         text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "eigene geräte" on public.push_subs;
create policy "eigene geräte" on public.push_subs for select to authenticated using (user_id = auth.uid());

-- Gerät an-/ummelden (ein Gerät gehört immer dem zuletzt angemeldeten Konto)
create or replace function public.push_subscribe(p_sub jsonb, p_ua text default null) returns void
language sql security definer set search_path = public as $$
  insert into push_subs (endpoint, user_id, sub, ua) values (p_sub->>'endpoint', auth.uid(), p_sub, p_ua)
  on conflict (endpoint) do update set user_id = excluded.user_id, sub = excluded.sub, ua = excluded.ua, created_at = now();
$$;
create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.push_subscribe(jsonb, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(jsonb, text), public.push_unsubscribe(text) to authenticated;

create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text; a text;
begin
  if new.col not in ('notes','studio','tasks') then return new; end if;
  select v into s from push_config where k = 'secret';
  select v into a from push_config where k = 'anon';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://nucdwotzhdtyzijempml.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret', s, 'Authorization', 'Bearer ' || a),
    body := jsonb_build_object('op', TG_OP, 'col', new.col, 'id', new.id, 'data', new.data,
                               'old', case when TG_OP = 'UPDATE' then old.data end, 'by', new.updated_by));
  return new;
exception when others then return new;   -- Push darf Speichern nie blockieren
end $$;
drop trigger if exists docs_push on public.docs;
create trigger docs_push after insert or update on public.docs for each row execute function public.push_notify();
select 'ok' as stand;
