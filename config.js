/* Verbindung zur Datenbank. Der "anon key" ist öffentlich gedacht –
   geschützt wird über Login + Zugriffsregeln (RLS) in Supabase. */
window.CLOUDS_CONFIG = {
  SUPABASE_URL: 'https://nucdwotzhdtyzijempml.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51Y2R3b3R6aGR0eXppamVtcG1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzMTc2ODQsImV4cCI6MjEwOTg5MzY4NH0.k4qhCKmdQLjhmbkc6TLlSBYWWtszW41BuGZJeAYP6p4',
  EMAIL_DOMAIN: 'team.cloudsrecords.de'   // Benutzername "sarah" → sarah@team.cloudsrecords.de (nur intern, kein Postfach)
};
