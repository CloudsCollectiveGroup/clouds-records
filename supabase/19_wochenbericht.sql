-- 19: Wochenbericht freitags 15:00 UTC (16:00 Winterzeit / 17:00 Sommerzeit in Hamburg)
select cron.unschedule(jobid) from cron.job where jobname = 'clouds-wochenbericht';
select cron.schedule('clouds-wochenbericht', '0 15 * * 5', $cron$
  select net.http_post(
    url := 'https://nucdwotzhdtyzijempml.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-push-secret', (select v from public.push_config where k = 'secret'),
      'Authorization', 'Bearer ' || (select v from public.push_config where k = 'anon')),
    body := '{"op":"WEEKLY"}'::jsonb);
$cron$);
select jobname, schedule from cron.job order by jobname;
