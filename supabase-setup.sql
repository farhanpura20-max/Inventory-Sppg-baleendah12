-- SETUP DATABASE ONLINE UNTUK APLIKASI INVENTORY SPPG BALEENDAH 12
-- Jalankan file ini di Supabase > SQL Editor > New Query > Run.

create table if not exists public.inventory_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.inventory_state enable row level security;

drop policy if exists "sppg_inventory_state_read" on public.inventory_state;
drop policy if exists "sppg_inventory_state_insert" on public.inventory_state;
drop policy if exists "sppg_inventory_state_update" on public.inventory_state;
drop policy if exists "sppg_inventory_state_delete" on public.inventory_state;

-- Kebijakan ini dibuat untuk prototipe multiuser tanpa login.
-- Siapa pun yang membuka aplikasi dan memiliki anon key dapat membaca/menulis data record SPPG ini.
-- Untuk versi resmi, gunakan login dan kebijakan RLS per role.
create policy "sppg_inventory_state_read"
on public.inventory_state
for select
to anon
using (id = 'sppg-baleendah-12');

create policy "sppg_inventory_state_insert"
on public.inventory_state
for insert
to anon
with check (id = 'sppg-baleendah-12');

create policy "sppg_inventory_state_update"
on public.inventory_state
for update
to anon
using (id = 'sppg-baleendah-12')
with check (id = 'sppg-baleendah-12');

create policy "sppg_inventory_state_delete"
on public.inventory_state
for delete
to anon
using (id = 'sppg-baleendah-12');
