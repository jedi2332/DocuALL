create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  zip_code text not null default '',
  employer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled',
  kind text not null default 'scanned',
  vendor text not null default '',
  doc_date text not null default '',
  amount text not null default '',
  category text not null default 'Other',
  page_paths jsonb not null default '[]'::jsonb,
  page_count int not null default 0,
  pdf_path text,
  thumbnail_path text,
  ocr_text text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "documents_select_own" on public.documents for select to authenticated using (auth.uid() = user_id);
create policy "documents_insert_own" on public.documents for insert to authenticated with check (auth.uid() = user_id);
create policy "documents_update_own" on public.documents for update to authenticated using (auth.uid() = user_id);
create policy "documents_delete_own" on public.documents for delete to authenticated using (auth.uid() = user_id);

create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null default 'draw',
  image_path text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.signatures to authenticated;
grant all on public.signatures to service_role;
alter table public.signatures enable row level security;
create policy "signatures_select_own" on public.signatures for select to authenticated using (auth.uid() = user_id);
create policy "signatures_insert_own" on public.signatures for insert to authenticated with check (auth.uid() = user_id);
create policy "signatures_delete_own" on public.signatures for delete to authenticated using (auth.uid() = user_id);

create table public.signing_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  doc_id uuid not null references public.documents(id) on delete cascade,
  signer_name text not null,
  token text not null unique,
  status text not null default 'pending',
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);
grant select, insert, update, delete on public.signing_requests to authenticated;
grant all on public.signing_requests to service_role;
alter table public.signing_requests enable row level security;
create policy "signing_requests_select_own" on public.signing_requests for select to authenticated using (auth.uid() = owner_id);
create policy "signing_requests_insert_own" on public.signing_requests for insert to authenticated with check (auth.uid() = owner_id);
create policy "signing_requests_update_own" on public.signing_requests for update to authenticated using (auth.uid() = owner_id);
create policy "signing_requests_delete_own" on public.signing_requests for delete to authenticated using (auth.uid() = owner_id);

create policy "documents_bucket_owner_select" on storage.objects for select to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_bucket_owner_insert" on storage.objects for insert to authenticated with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_bucket_owner_update" on storage.objects for update to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_bucket_owner_delete" on storage.objects for delete to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "signatures_bucket_owner_select" on storage.objects for select to authenticated using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "signatures_bucket_owner_insert" on storage.objects for insert to authenticated with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "signatures_bucket_owner_delete" on storage.objects for delete to authenticated using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);