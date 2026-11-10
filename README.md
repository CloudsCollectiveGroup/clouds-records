# Clouds Records – Web-App

Link verschicken, im Browser öffnen, anmelden. Am Handy: Teilen → „Zum Home-Bildschirm“.

## Aufbau
- `index.html` – die App (Design B), läuft auf GitHub Pages
- `config.js` – Verbindung zu Supabase (URL + anon key)
- `supabase/01_schema.sql` – Tabelle, Zugriffsregeln, Live-Abgleich
- `supabase/02_daten.sql` – Bestandsdaten (5 Artists, Anuj, 45 Releases, Fahrpläne)

## Einrichtung (einmalig)
1. Supabase-Projekt „clouds-records“, Region Frankfurt (eu-central-1)
2. SQL-Editor: erst `01_schema.sql`, dann `02_daten.sql` ausführen
3. Authentication → Sign In / Providers → Email: „Allow new users to sign up“ AUS, „Confirm email“ AUS
4. Authentication → Users → „Add user“: E-Mail `benutzername@team.cloudsrecords.de`, Passwort, „Auto Confirm“ an.
   Anzeigename optional über User Metadata `{"name":"Sarah"}`
5. Project Settings → API: URL und anon key in `config.js` eintragen
6. GitHub → Settings → Pages → Branch `main`, Ordner `/`

## Phase 2 (geplant)
- Rollen: Artists sehen nur den eigenen Bereich (Zugriffsregeln je Artist)
- Audio/Cover-Upload über Supabase Storage (ab Pro-Paket)
