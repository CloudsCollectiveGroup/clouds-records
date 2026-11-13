-- 29: Push für Kaufanfragen (14.11.2026) – col 'expenses' mit kind 'req'.

create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s text; a text;
begin
  if new.col not in ('notes','studio','tasks','chat','todos','gigs','releases','expenses') then return new; end if;
  -- Ausgaben nur für Kaufanfragen
  if new.col = 'expenses' and coalesce(new.data->>'kind','') <> 'req' then return new; end if;
  -- Releases nur, wenn sich Kampagnen geändert haben (Freigaben, neue Kampagne, Budget)
  if new.col = 'releases' and (TG_OP <> 'UPDATE' or new.data->'camps' is not distinct from old.data->'camps') then return new; end if;
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
