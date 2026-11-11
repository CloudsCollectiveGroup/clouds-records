-- Clouds Records – Audio und Cover direkt in der App (Supabase Storage, privat)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('audio',  'audio',  false, 52428800, array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/wave']),
  ('covers', 'covers', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Pfade: audio/<artist>/<track>/<version>.mp3 · covers/<artist>/<release>-<zeit>.jpg
drop policy if exists "medien lesen"      on storage.objects;
drop policy if exists "medien hochladen"  on storage.objects;
drop policy if exists "medien löschen"    on storage.objects;
create policy "medien lesen" on storage.objects for select to authenticated using (
  bucket_id in ('audio','covers') and (
    public.my_role() in ('team','producer')
    or (public.my_role() = 'artist' and (storage.foldername(name))[1] = public.my_person())));
create policy "medien hochladen" on storage.objects for insert to authenticated with check (
  (bucket_id = 'audio' and (
     public.my_role() in ('team','producer')
     or (public.my_role() = 'artist' and (storage.foldername(name))[1] = public.my_person())))
  or (bucket_id = 'covers' and public.my_role() = 'team'));
create policy "medien löschen" on storage.objects for delete to authenticated using (
  bucket_id in ('audio','covers') and public.my_role() = 'team');

select id, public, file_size_limit from storage.buckets;
