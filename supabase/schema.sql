-- ============================================================================
-- MiCasa · Esquema de base de datos (PostgreSQL / Supabase)
-- App multi-usuario de gestión del hogar: citas, gastos, listas y cumpleaños.
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensión para UUIDs (ya activa en Supabase por defecto)
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Perfiles de usuario (1:1 con auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Casas / hogares
-- ----------------------------------------------------------------------------
create table if not exists public.casas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Miembros de una casa (varios usuarios pueden editar la misma casa)
-- ----------------------------------------------------------------------------
create table if not exists public.casa_members (
  casa_id uuid not null references public.casas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (casa_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Secciones / categorías de gasto (Bebé, Reformas, Hogar, Comida, ...)
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  name text not null,
  color text not null default '#4f46e5',
  icon text not null default 'pricetag',
  budget numeric(12, 2),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Gastos
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  title text not null,
  amount numeric(12, 2) not null check (amount > 0),
  spent_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Citas (médico, escuela, mascota, personal...)
-- ----------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  title text not null,
  description text,
  person text,
  location text,
  kind text not null default 'personal'
    check (kind in ('medico', 'escuela', 'mascota', 'personal', 'otro')),
  starts_at timestamptz not null,
  reminder_at timestamptz,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Listas de la compra
-- ----------------------------------------------------------------------------
create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  name text not null,
  quantity numeric(10, 2),
  unit text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Contactos (para recordatorios de cumpleaños)
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  birth_date date not null,
  relationship text,
  phone text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Índices
-- ============================================================================
create index if not exists idx_casa_members_user on public.casa_members (user_id);
create index if not exists idx_casa_members_casa on public.casa_members (casa_id);
create index if not exists idx_expenses_casa on public.expenses (casa_id);
create index if not exists idx_expenses_category on public.expenses (category_id);
create index if not exists idx_appointments_casa on public.appointments (casa_id);
create index if not exists idx_appointments_starts on public.appointments (starts_at);
create index if not exists idx_categories_casa on public.categories (casa_id);
create index if not exists idx_shopping_lists_casa on public.shopping_lists (casa_id);
create index if not exists idx_shopping_items_list on public.shopping_items (list_id);
create index if not exists idx_contacts_casa on public.contacts (casa_id);

-- ============================================================================
-- Funciones auxiliares para RLS
-- ============================================================================
create or replace function public.is_casa_member(casa uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.casa_members cm
    where cm.casa_id = casa and cm.user_id = auth.uid()
  );
$$;

create or replace function public.is_casa_owner(casa uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.casa_members cm
    where cm.casa_id = casa and cm.user_id = auth.uid() and cm.role = 'owner'
  );
$$;

-- Genera un código de invitación único (volatile: valor nuevo por evaluación)
create or replace function public.generate_invite_code()
returns text
language sql volatile security definer set search_path = public
as $$
  select upper(substr(md5(gen_random_uuid()::text), 1, 8));
$$;

-- El código de invitación se genera en la BD, no en el cliente
alter table public.casas alter column invite_code set default public.generate_invite_code();

-- Únete a una casa mediante su código de invitación.
-- Es SECURITY DEFINER porque el nuevo miembro aún no tiene RLS sobre casas/casa_members.
create or replace function public.join_casa(code text)
returns public.casas
language plpgsql security definer set search_path = public
as $$
declare
  target public.casas;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para unirte a una casa.';
  end if;

  select * into target
  from public.casas
  where upper(invite_code) = upper(join_casa.code);

  if not found then
    raise exception 'No existe ninguna casa con ese código.';
  end if;

  insert into public.casa_members (casa_id, user_id, role)
  values (target.id, auth.uid(), 'member')
  on conflict (casa_id, user_id) do nothing;

  return target;
end;
$$;

revoke all on function public.join_casa(text) from public;
grant execute on function public.join_casa(text) to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.casas enable row level security;
alter table public.casa_members enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.appointments enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.contacts enable row level security;

-- profiles: cada usuario ve/edita su propio perfil
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Los miembros de la misma casa pueden leer el perfil (display_name) de sus co-miembros
drop policy if exists "profiles_select_member" on public.profiles;
create policy "profiles_select_member" on public.profiles
  for select using (
    exists (
      select 1 from public.casa_members cm
      where cm.user_id = profiles.id
        and public.is_casa_member(cm.casa_id)
    )
  );

-- casas: el creador puede insertar; se ve si se es miembro; solo el owner la modifica/borra
drop policy if exists "casas_insert" on public.casas;
create policy "casas_insert" on public.casas
  for insert with check (auth.uid() = created_by);

drop policy if exists "casas_select_member" on public.casas;
create policy "casas_select_member" on public.casas
  for select using (public.is_casa_member(id));

drop policy if exists "casas_update_member" on public.casas;
drop policy if exists "casas_update_owner" on public.casas;
create policy "casas_update_owner" on public.casas
  for update using (public.is_casa_owner(id))
  with check (public.is_casa_owner(id));

drop policy if exists "casas_delete_owner" on public.casas;
create policy "casas_delete_owner" on public.casas
  for delete using (public.is_casa_owner(id));

-- casa_members: ver miembros de casas a las que perteneces;
-- gestionar miembros (alta/promoción) solo el owner; cualquiera puede salirse.
drop policy if exists "members_select" on public.casa_members;
create policy "members_select" on public.casa_members
  for select using (public.is_casa_member(casa_id));

drop policy if exists "members_insert" on public.casa_members;
create policy "members_insert" on public.casa_members
  for insert with check (public.is_casa_owner(casa_id));

drop policy if exists "members_update" on public.casa_members;
create policy "members_update" on public.casa_members
  for update using (public.is_casa_owner(casa_id))
  with check (public.is_casa_owner(casa_id));

drop policy if exists "members_delete" on public.casa_members;
create policy "members_delete" on public.casa_members
  for delete using (user_id = auth.uid() or public.is_casa_owner(casa_id));

-- Contenido de la casa: accesible si eres miembro.
-- En INSERT, `user_id` se obliga a ser el usuario autenticado (sin suplantación).
drop policy if exists "categories_all_member" on public.categories;
create policy "categories_all_member" on public.categories
  for all using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

drop policy if exists "expenses_all_member" on public.expenses;
drop policy if exists "expenses_select_member" on public.expenses;
drop policy if exists "expenses_insert_member" on public.expenses;
drop policy if exists "expenses_update_member" on public.expenses;
drop policy if exists "expenses_delete_member" on public.expenses;
create policy "expenses_select_member" on public.expenses
  for select using (public.is_casa_member(casa_id));

create policy "expenses_insert_member" on public.expenses
  for insert with check (public.is_casa_member(casa_id) and user_id = auth.uid());

create policy "expenses_update_member" on public.expenses
  for update using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

create policy "expenses_delete_member" on public.expenses
  for delete using (public.is_casa_member(casa_id));

drop policy if exists "appointments_all_member" on public.appointments;
drop policy if exists "appointments_select_member" on public.appointments;
drop policy if exists "appointments_insert_member" on public.appointments;
drop policy if exists "appointments_update_member" on public.appointments;
drop policy if exists "appointments_delete_member" on public.appointments;
create policy "appointments_select_member" on public.appointments
  for select using (public.is_casa_member(casa_id));

create policy "appointments_insert_member" on public.appointments
  for insert with check (public.is_casa_member(casa_id) and user_id = auth.uid());

create policy "appointments_update_member" on public.appointments
  for update using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

create policy "appointments_delete_member" on public.appointments
  for delete using (public.is_casa_member(casa_id));

drop policy if exists "shopping_lists_all_member" on public.shopping_lists;
drop policy if exists "shopping_lists_select_member" on public.shopping_lists;
drop policy if exists "shopping_lists_insert_member" on public.shopping_lists;
drop policy if exists "shopping_lists_update_member" on public.shopping_lists;
drop policy if exists "shopping_lists_delete_member" on public.shopping_lists;
create policy "shopping_lists_select_member" on public.shopping_lists
  for select using (public.is_casa_member(casa_id));

create policy "shopping_lists_insert_member" on public.shopping_lists
  for insert with check (public.is_casa_member(casa_id) and user_id = auth.uid());

create policy "shopping_lists_update_member" on public.shopping_lists
  for update using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

create policy "shopping_lists_delete_member" on public.shopping_lists
  for delete using (public.is_casa_member(casa_id));

drop policy if exists "shopping_items_all_member" on public.shopping_items;
create policy "shopping_items_all_member" on public.shopping_items
  for all using (
    exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_items.list_id and public.is_casa_member(sl.casa_id)
    )
  )
  with check (
    exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_items.list_id and public.is_casa_member(sl.casa_id)
    )
  );

drop policy if exists "contacts_all_member" on public.contacts;
drop policy if exists "contacts_select_member" on public.contacts;
drop policy if exists "contacts_insert_member" on public.contacts;
drop policy if exists "contacts_update_member" on public.contacts;
drop policy if exists "contacts_delete_member" on public.contacts;
create policy "contacts_select_member" on public.contacts
  for select using (public.is_casa_member(casa_id));

create policy "contacts_insert_member" on public.contacts
  for insert with check (public.is_casa_member(casa_id) and user_id = auth.uid());

create policy "contacts_update_member" on public.contacts
  for update using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

create policy "contacts_delete_member" on public.contacts
  for delete using (public.is_casa_member(casa_id));

-- ============================================================================
-- Triggers automáticos
-- ============================================================================
-- Crea el perfil al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Al crear una casa, su creador pasa a ser miembro owner
create or replace function public.handle_new_casa()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.casa_members (casa_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

drop trigger if exists on_casa_created on public.casas;
create trigger on_casa_created
  after insert on public.casas
  for each row execute procedure public.handle_new_casa();

-- ============================================================================
-- Restricciones de integridad (longitudes máximas)
-- ============================================================================
alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (char_length(display_name) between 1 and 40);

alter table public.casas drop constraint if exists casas_name_len;
alter table public.casas add constraint casas_name_len
  check (char_length(name) between 1 and 60);

alter table public.categories drop constraint if exists categories_name_len;
alter table public.categories add constraint categories_name_len
  check (char_length(name) between 1 and 120);

alter table public.expenses drop constraint if exists expenses_title_len;
alter table public.expenses add constraint expenses_title_len
  check (char_length(title) between 1 and 120);
alter table public.expenses drop constraint if exists expenses_note_len;
alter table public.expenses add constraint expenses_note_len
  check (note is null or char_length(note) <= 1000);

alter table public.appointments drop constraint if exists appointments_title_len;
alter table public.appointments add constraint appointments_title_len
  check (char_length(title) between 1 and 120);
alter table public.appointments drop constraint if exists appointments_desc_len;
alter table public.appointments add constraint appointments_desc_len
  check (description is null or char_length(description) <= 2000);
alter table public.appointments drop constraint if exists appointments_person_len;
alter table public.appointments add constraint appointments_person_len
  check (person is null or char_length(person) <= 120);
alter table public.appointments drop constraint if exists appointments_location_len;
alter table public.appointments add constraint appointments_location_len
  check (location is null or char_length(location) <= 120);

alter table public.shopping_lists drop constraint if exists shopping_lists_title_len;
alter table public.shopping_lists add constraint shopping_lists_title_len
  check (char_length(title) between 1 and 120);

alter table public.shopping_items drop constraint if exists shopping_items_name_len;
alter table public.shopping_items add constraint shopping_items_name_len
  check (char_length(name) between 1 and 120);

alter table public.contacts drop constraint if exists contacts_name_len;
alter table public.contacts add constraint contacts_name_len
  check (char_length(name) between 1 and 120);
alter table public.contacts drop constraint if exists contacts_relationship_len;
alter table public.contacts add constraint contacts_relationship_len
  check (relationship is null or char_length(relationship) <= 80);
alter table public.contacts drop constraint if exists contacts_phone_len;
alter table public.contacts add constraint contacts_phone_len
  check (phone is null or char_length(phone) <= 30);

-- ============================================================================
-- Realtime (para que todos los miembros de una casa vean cambios al instante)
-- ============================================================================
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.shopping_lists;
alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.contacts;
alter publication supabase_realtime add table public.casa_members;
