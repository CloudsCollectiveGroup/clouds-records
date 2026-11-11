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

## Zugänge anlegen
Supabase → Authentication → Users → Add user → Create new user, „Auto Confirm User“ an.
Die Rolle ergibt sich automatisch aus dem Benutzernamen (`supabase/03_rollen.sql`):
- `sarah@…`, `hakuna@…`, `mahir@…`, `aije@…`, `amir@…` → Artist, sieht nur den eigenen Bereich
- `anuj@…` → Produzent, sieht alles, kann Verträge nicht ändern
- jeder andere Name (z. B. `cem@…`, `nikolina@…`) → Team, sieht und ändert alles

## Audio & Cover
- MP3/M4A bis 50 MB direkt in der App hochladen und abspielen (Track → „Version“), privat in Supabase Storage
- Cover im Release über „Bearbeiten“, wird automatisch auf max. 1400 px verkleinert
- WAV-Masters > 50 MB weiter im SharePoint-Archiv; mit Supabase Pro bis 500 GB pro Datei möglich
- Rechte wie bei den Daten: Artists nur eigener Ordner, Cover nur Team
