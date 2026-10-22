-- Audiencia de los avisos: "solo yo" o "toda la casa".
--
-- Hasta ahora la audiencia estaba fijada en el código: las citas avisaban solo a
-- quien las creó y la nevera avisaba a todos los miembros con el aviso activado.
-- Ahora cada fila decide, y las filas que ya existían conservan el comportamiento
-- que tenían antes de esta migración.

-- ============================================================================
-- Citas
-- ============================================================================
-- `me` es el valor por defecto y también el relleno de las filas existentes: es
-- exactamente lo que hacía el cron al filtrar por `user_id`.
alter table public.appointments
  add column if not exists notify_audience text not null default 'me';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_notify_audience_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_notify_audience_check
      check (notify_audience in ('me', 'all'));
  end if;
end;
$$;

comment on column public.appointments.notify_audience is
  'Quién recibe el recordatorio: me (solo quien creó la cita) o all (toda la casa).';

-- ============================================================================
-- Nevera
-- ============================================================================
-- Aquí el relleno tiene que ser `all` para no cambiar el comportamiento de los
-- ítems que ya existían: el cron avisaba a todos los miembros. Las filas nuevas
-- nacen en `me` y el cliente manda la audiencia elegida de forma explícita.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fridge_items'
      and column_name = 'notify_audience'
  ) then
    alter table public.fridge_items
      add column notify_audience text not null default 'me';

    -- Backfill: solo si la columna se acaba de crear. Filas que ya tenían
    -- `notify_audience` explícito (redeploy, o migración ya aplicada) no se tocan.
    update public.fridge_items set notify_audience = 'all' where notify_audience = 'me';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fridge_items_notify_audience_check'
      and conrelid = 'public.fridge_items'::regclass
  ) then
    alter table public.fridge_items
      add constraint fridge_items_notify_audience_check
      check (notify_audience in ('me', 'all'));
  end if;
end;
$$;

comment on column public.fridge_items.notify_audience is
  'Quién recibe el aviso de caducidad: me (solo quien lo creó) o all (toda la casa).';

-- Congelar audiencia y autor: solo el autor puede cambiarlas.
create or replace function public.appointments_freeze_author()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- `ON DELETE SET NULL` de la FK también llega aquí: borrar la cuenta debe
  -- poder dejar la cita huérfana, pero nadie puede reasignarla a otra persona.
  if new.user_id is distinct from old.user_id
     and not (
       new.user_id is null
       and old.user_id is not null
       and not exists (select 1 from auth.users u where u.id = old.user_id)
     ) then
    raise exception 'no se puede cambiar el autor de una cita';
  end if;
  if new.notify_audience is distinct from old.notify_audience and auth.uid() is distinct from old.user_id then
    raise exception 'solo el autor puede cambiar la audiencia de una cita';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_freeze_author on public.appointments;
create trigger appointments_freeze_author
  before update on public.appointments
  for each row execute function public.appointments_freeze_author();

revoke all on function public.appointments_freeze_author() from public, anon, authenticated;

create or replace function public.fridge_items_freeze_audience()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.notify_audience is distinct from old.notify_audience and auth.uid() is distinct from old.user_id then
    raise exception 'solo el autor puede cambiar la audiencia de un ítem de nevera';
  end if;
  return new;
end;
$$;

drop trigger if exists fridge_items_freeze_audience on public.fridge_items;
create trigger fridge_items_freeze_audience
  before update on public.fridge_items
  for each row execute function public.fridge_items_freeze_audience();

revoke all on function public.fridge_items_freeze_audience() from public, anon, authenticated;
