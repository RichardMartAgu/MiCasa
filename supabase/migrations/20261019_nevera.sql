-- Nevera: ítems con fecha de caducidad y preferencia de aviso.
--
-- `20260925_web_push.sql` ya está aplicada en producción y no se toca: la
-- columna `fridge_choice` y su `check` viven aquí, en una migración nueva, para
-- que el historial remoto y el local digan lo mismo.

-- ============================================================================
-- Preferencia de aviso de caducidad
-- ============================================================================
alter table public.push_preferences
  add column if not exists fridge_choice text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'push_preferences_fridge_choice_check'
      and conrelid = 'public.push_preferences'::regclass
  ) then
    alter table public.push_preferences
      add constraint push_preferences_fridge_choice_check
      check (fridge_choice in ('none', 'day-before', 'same-day', 'both'));
  end if;
end;
$$;

-- ============================================================================
-- Ítems de nevera
-- ============================================================================
create table if not exists public.fridge_items (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  -- Día de calendario, no instante: la caducidad es una fecha, no una hora.
  expiry_date date not null,
  quantity numeric(10, 2),
  unit text,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  constraint fridge_items_name_length check (char_length(name) between 1 and 120),
  constraint fridge_items_quantity_positive check (quantity is null or quantity > 0),
  constraint fridge_items_unit_length check (unit is null or char_length(unit) <= 32)
);

comment on table public.fridge_items is
  'Ítems de la nevera con fecha de caducidad. Cada miembro de la casa puede gestionarlos; los avisos los manda el servidor o el dispositivo según la plataforma.';

create index if not exists idx_fridge_items_casa on public.fridge_items (casa_id);
create index if not exists idx_fridge_items_user on public.fridge_items (user_id);
create index if not exists idx_fridge_items_expiry on public.fridge_items (expiry_date);

-- Autoría y casa inmutables: cualquier miembro puede editar el contenido, pero
-- nadie puede reasignar un ítem a otra persona ni moverlo a otra casa.
create or replace function public.fridge_items_freeze_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.casa_id <> old.casa_id then
    raise exception 'no se puede cambiar el autor ni la casa de un ítem de nevera';
  end if;
  return new;
end;
$$;

drop trigger if exists fridge_items_freeze_owner on public.fridge_items;
create trigger fridge_items_freeze_owner
  before update on public.fridge_items
  for each row execute function public.fridge_items_freeze_owner();

-- Tope por casa: evita que una casa acumule miles de filas y que el cliente
-- descargue o programe notificaciones sin límite. El reparto del cron limita a
-- 100, pero el tope de escritura protege también la lectura y el almacenamiento.
create or replace function public.fridge_items_limit_per_casa()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('fridge:' || new.casa_id::text));
  if (select count(*) from public.fridge_items where casa_id = new.casa_id) >= 200 then
    raise exception 'la nevera de esta casa ha alcanzado el límite de 200 ítems';
  end if;
  return new;
end;
$$;

drop trigger if exists fridge_items_limit_per_casa on public.fridge_items;
create trigger fridge_items_limit_per_casa
  before insert on public.fridge_items
  for each row execute function public.fridge_items_limit_per_casa();

revoke all on function public.fridge_items_freeze_owner() from public, anon, authenticated;
revoke all on function public.fridge_items_limit_per_casa() from public, anon, authenticated;

alter table public.fridge_items enable row level security;

-- Realtime: sin publicar la tabla, la pantalla Nevera no refresca sus propias
-- mutaciones hasta un remount. `replica identity full` es lo que hace evaluable
-- el filtro `casa_id` en DELETE/UPDATE.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fridge_items'
  ) then
    alter publication supabase_realtime add table public.fridge_items;
  end if;
end;
$$;

alter table public.fridge_items replica identity full;

drop policy if exists "fridge_items_select_member" on public.fridge_items;
create policy "fridge_items_select_member" on public.fridge_items
  for select using (public.is_casa_member(casa_id));

drop policy if exists "fridge_items_insert_member" on public.fridge_items;
create policy "fridge_items_insert_member" on public.fridge_items
  for insert with check (
    public.is_casa_member(casa_id) and user_id = (select auth.uid())
  );

drop policy if exists "fridge_items_update_member" on public.fridge_items;
create policy "fridge_items_update_member" on public.fridge_items
  for update using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

drop policy if exists "fridge_items_delete_member" on public.fridge_items;
create policy "fridge_items_delete_member" on public.fridge_items
  for delete using (public.is_casa_member(casa_id));
