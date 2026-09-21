-- Quita el tipo 'mascota' de los tipos de cita.
-- Las citas existentes con kind 'mascota' pasan a 'personal' para
-- conservar su tipo en la UI (los chips salen de appointment_kinds).

delete from public.appointment_kinds where name = 'mascota';

update public.appointments set kind = 'personal' where kind = 'mascota';

-- Reordena los tipos restantes tras borrar mascota.
update public.appointment_kinds set sort_order = 2 where name = 'personal';
update public.appointment_kinds set sort_order = 3 where name = 'otro';

-- Nuevas casas ya no siembran 'mascota'.
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
    ('personal', 'person-outline', 2),
    ('otro', 'ellipsis-horizontal-outline', 3)
  ) as k(name, icon, sort_order);

  return new;
end;
$$;