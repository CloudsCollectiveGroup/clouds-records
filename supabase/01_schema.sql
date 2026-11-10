-- Clouds Records – Datenbank-Grundgerüst (einmalig im Supabase SQL-Editor ausführen)
create table if not exists public.docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid        default auth.uid(),
  primary key (col, id)
);

alter table public.docs enable row level security;

-- Phase 1: Jeder angemeldete Nutzer sieht und bearbeitet alles. Ohne Login: nichts.
drop policy if exists "team liest"     on public.docs;
drop policy if exists "team schreibt"  on public.docs;
drop policy if exists "team ändert"    on public.docs;
drop policy if exists "team löscht"    on public.docs;
create policy "team liest"    on public.docs for select to authenticated using (true);
create policy "team schreibt" on public.docs for insert to authenticated with check (true);
create policy "team ändert"   on public.docs for update to authenticated using (true) with check (true);
create policy "team löscht"   on public.docs for delete to authenticated using (true);
revoke all on public.docs from anon;

create or replace function public.touch_docs() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_docs();

-- Teil-Update (z. B. Aufgabe abhaken), ohne andere Felder zu überschreiben
create or replace function public.doc_merge(p_col text, p_id text, p_patch jsonb)
returns jsonb language sql security invoker as $$
  update public.docs set data = data || p_patch where col = p_col and id = p_id returning data;
$$;
revoke execute on function public.doc_merge(text, text, jsonb) from public, anon;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;

-- Live-Aktualisierung zwischen allen Geräten
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
