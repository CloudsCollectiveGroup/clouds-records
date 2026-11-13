-- 32: Studio-Gäste mit Zusage (14.11.2026)
-- Artist darf Studio-Slots lesen, zu denen er als Gast eingeladen ist (nur lesen).
-- Antwort (ja/nein) nur über die Funktion studio_rsvp – jeder antwortet nur für sich selbst.

drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select to authenticated using (
  my_role() = 'team'
  or (my_role() = 'producer' and col not in ('gigfin','mwfin','contacts','expenses','asks'))
  or (my_role() = 'artist' and (
       (col = 'people' and (id = my_person() or data->>'role' = 'Produzent'))
    or (col = 'beats' and (data->>'status' = 'Freigegeben'
         or (data->>'status' in ('Reserviert','Platziert','Duo') and (data->>'reservedFor' = my_person() or data->>'reservedFor2' = my_person()))
         or (data->>'status' = 'Auswahl' and coalesce(data->'candidates','[]'::jsonb) ? my_person())))
    or (col = 'interest')
    or (col = 'notes' and (coalesce(data->'to','[]'::jsonb) ? my_person() or data->>'fromArtist' = my_person()))
    or (col not in ('people','beats','sessions','interest','notes','gigfin','contacts','expenses') and doc_artist(col, data) = my_person())
    or (col = 'gigs' and data->>'req' = 'ok')
    or (col = 'studio' and coalesce(data->'guests','[]'::jsonb) ? my_person())
    or (col = 'gigfin' and public.gig_involves(id, my_person()))
    or (col = 'chat' and data->>'ref' like 'gig:%' and public.gig_has_co(split_part(data->>'ref', ':', 2), my_person()))
  ))
);


create or replace function public.studio_rsvp(p_id text, p_key text, p_ans text) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text := my_role(); v_key text; v_data jsonb;
begin
  if p_ans not in ('ja','nein') then raise exception 'Antwort ungültig'; end if;
  v_key := case v_role when 'artist' then my_person() when 'producer' then 'P'
                       when 'team' then case when p_key in ('C','TH','K','N') then p_key end end;
  if v_key is null then raise exception 'Keine Berechtigung'; end if;
  select data into v_data from docs where col = 'studio' and id = p_id;
  if v_data is null then raise exception 'Studio-Slot nicht gefunden'; end if;
  if not (coalesce(v_data->'guests','[]'::jsonb) ? v_key) then raise exception 'Nicht eingeladen'; end if;
  update docs set data = jsonb_set(data, '{rsvp}', coalesce(data->'rsvp','{}'::jsonb) || jsonb_build_object(v_key, p_ans))
    where col = 'studio' and id = p_id;
end $$;
revoke execute on function public.studio_rsvp(text, text, text) from public, anon;
grant execute on function public.studio_rsvp(text, text, text) to authenticated;
select 'ok' as stand;
