-- Tipos de cita editables por casa ("médico, escuela…").
-- Los chips de tipo pasan de constante a tabla editable (añadir/editar/borrar).

create table if not exists public.appointment_kinds (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  name text not null,
  icon text not null default 'ellipsis-horizontal-outline',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint appointment_kinds_casa_id_name_key unique (casa_id, name),
  constraint appointment_kinds_name_len check (char_length(name) between 1 and 40)
);

-- Los tipos de cita dejan de ser un CHECK fijo de 5 valores.
alter table public.appointments drop constraint if exists appointments_kind_check;
alter table public.appointments add constraint appointments_kind_len
  check (char_length(kind) between 1 and 40);

alter table public.appointment_kinds enable row level security;

drop policy if exists "appointment_kinds_all_member" on public.appointment_kinds;
create policy "appointment_kinds_all_member" on public.appointment_kinds
  for all using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

-- Siembra tipos por defecto en casas ya existentes sin tipos.
insert into public.appointment_kinds (casa_id, name, icon, sort_order)
select c.id, k.name, k.icon, k.sort_order
from public.casas c
cross join (values
  ('medico', 'medkit-outline', 0),
  ('escuela', 'school-outline', 1),
  ('mascota', 'paw-outline', 2),
  ('personal', 'person-outline', 3),
  ('otro', 'ellipsis-horizontal-outline', 4)
) as k(name, icon, sort_order)
where not exists (
  select 1 from public.appointment_kinds ak where ak.casa_id = c.id
);

-- Nuevas casas también siembran tipos por defecto (trigger ampliado).
create or replace function public.handle_new_casa()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.casa_members (casa_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;

  insert into public.appointment_kinds (casa_id, name, icon, sort_order)
  select new.id, k.name, k.icon, k.sort_order
  from (values
    ('medico', 'medkit-outline', 0),
    ('escuela', 'school-outline', 1),
    ('mascota', 'paw-outline', 2),
    ('personal', 'person-outline', 3),
    ('otro', 'ellipsis-horizontal-outline', 4)
  ) as k(name, icon, sort_order);

  return new;
end;
$$;

alter publication supabase_realtime add table public.appointment_kinds;