-- 30: Neuer Login „kacper“ (14.11.2026) – Schreibweise Kacper.
-- 1) Freigabe: Konto kacper@team.cloudsrecords.de wird beim Anlegen automatisch Team (Trigger assign_member).
insert into public.team_allow (username) values ('kacper') on conflict do nothing;
-- 2) Nach dem Anlegen des Kontos prüfen:
select username, role from public.members where username in ('kasper','kacper');
-- 3) Später, wenn Kacper sich mit dem neuen Login angemeldet hat: alten Login „kasper“ in
--    Authentication → Users löschen (Mitglied-Eintrag fällt mit weg) und team_allow bereinigen:
--    delete from public.team_allow where username = 'kasper';

-- Erledigt 13.11.2026, 19:14: alter Login kasper gelöscht (Cem), team_allow bereinigt.
