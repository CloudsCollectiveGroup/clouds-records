-- 16: Chat pro Karte (Fahrplan-Schritt, Content-Beitrag, Musikvideo)
-- Nachrichten liegen als col = 'chat' mit ref ('tasks:<id>', 'content:<id>', 'video:<release>') und artist.
-- Artist liest und schreibt im eigenen Bereich, löscht nur eigene Nachrichten. Push an die Beteiligten.
create or replace function public.doc_artist(p_col text, p_data jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'people'   then null
    when p_col in ('releases','tasks','content','studio','interest','recordings','chat') then p_data->>'artist'
    when p_col = 'tracks'   then (select r.data->>'artist' from docs r where r.col='releases' and r.id = p_data->>'release')
    when p_col in ('versions','comments') then (
      select r.data->>'artist' from docs t join docs r on r.col='releases' and r.id = t.data->>'release'
      where t.col='tracks' and t.id = p_data->>'track')
  end $$;

drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert to authenticated with check (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col in ('tasks','tracks','versions','comments','studio','interest','recordings','content') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'chat' and doc_artist(col, data) = my_person() and data->>'byId' = auth.uid()::text)
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person() and data->>'fromId' = auth.uid()::text)
);

drop policy if exists "löschen" on public.docs;
create policy "löschen" on public.docs for delete to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col <> 'people')
  or (my_role() = 'artist' and col = 'comments' and data->>'author' = auth.uid()::text)
  or (my_role() = 'artist' and col in ('interest','recordings') and doc_artist(col, data) = my_person())
  or (my_role() = 'artist' and col = 'notes' and data->>'fromArtist' = my_person())
  or (my_role() = 'artist' and col in ('content','chat') and data->>'byId' = auth.uid()::text and doc_artist(col, data) = my_person())
);

create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text; a text;
begin
  if new.col not in ('notes','studio','tasks','chat') then return new; end if;
  if new.col = 'chat' and TG_OP <> 'INSERT' then return new; end if;
  select v into s from push_config where k = 'secret';
  select v into a from push_config where k = 'anon';
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://nucdwotzhdtyzijempml.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret', s, 'Authorization', 'Bearer ' || a),
    body := jsonb_build_object('op', TG_OP, 'col', new.col, 'id', new.id, 'data', new.data,
                               'old', case when TG_OP = 'UPDATE' then old.data end, 'by', new.updated_by));
  return new;
exception when others then return new;
end $$;
select 'ok' as stand;
