-- 17: Zugewiesene Planungs-Punkte (Location, Crew, Reel) selbst bestätigen
-- Artist darf NUR den Status von Punkten ändern, die ihm zugewiesen sind (o = 'A') und zu seinem eigenen Plan gehören.
-- Team darf alles. Schlüssel: Release-ID (Musikvideo) oder 'S~<artist>~<drehtag>' (Content-Drehtag).
create or replace function public.plan_set_status(p_key text, p_kind text, p_idx int, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text := my_role(); v_person text := my_person();
        v_col text; v_id text; v_artist text; v_path text[]; v_item jsonb; v_data jsonb; v_si int;
begin
  if p_kind = 'locations' and p_status not in ('Idee','Angefragt','Bestätigt','Abgesagt') then raise exception 'Status ungültig'; end if;
  if p_kind = 'crew'      and p_status not in ('Angefragt','Zugesagt','Abgesagt') then raise exception 'Status ungültig'; end if;
  if p_kind = 'reels'     and p_status not in ('Geplant','Gedreht','Geschnitten','Gepostet') then raise exception 'Status ungültig'; end if;
  if p_kind not in ('locations','crew','reels') then raise exception 'Art ungültig'; end if;

  if p_key like 'S~%' then
    v_col := 'people'; v_id := split_part(p_key, '~', 2); v_artist := v_id;
    select data into v_data from docs where col = 'people' and id = v_id;
    select (o - 1)::int into v_si from jsonb_array_elements(coalesce(v_data->'shoots','[]'::jsonb)) with ordinality as e(x, o)
      where x->>'id' = split_part(p_key, '~', 3);
    if v_si is null then raise exception 'Drehtag nicht gefunden'; end if;
    v_path := array['shoots', v_si::text, p_kind, p_idx::text];
  else
    v_col := 'releases'; v_id := p_key;
    select data into v_data from docs where col = 'releases' and id = v_id;
    v_artist := v_data->>'artist';
    v_path := array['video', p_kind, p_idx::text];
  end if;

  v_item := v_data #> v_path;
  if v_item is null then raise exception 'Punkt nicht gefunden'; end if;
  if not (v_role = 'team' or (v_role = 'artist' and v_artist = v_person and v_item->>'o' = 'A')) then
    raise exception 'Keine Berechtigung';
  end if;
  update docs set data = jsonb_set(data, v_path || array['status'], to_jsonb(p_status)) where col = v_col and id = v_id;
end $$;
revoke execute on function public.plan_set_status(text, text, int, text) from public, anon;
grant execute on function public.plan_set_status(text, text, int, text) to authenticated;
select 'ok' as stand;
