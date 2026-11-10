/* Verbindung zur Datenbank. Der "anon key" ist öffentlich gedacht –
   geschützt wird über Login + Zugriffsregeln in Supabase. */
window.CLOUDS_CONFIG = {
  SUPABASE_URL: 'https://DEIN-PROJEKT.supabase.co',
  SUPABASE_ANON_KEY: 'DEIN-ANON-KEY',
  EMAIL_DOMAIN: 'team.cloudsrecords.de'   // Benutzername "sarah" → sarah@team.cloudsrecords.de (nur intern, kein Postfach)
};
