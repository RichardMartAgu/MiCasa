-- Fix: borrados por realtime no refrescaban la UI.
-- Causa: replica identity DEFAULT -> los eventos DELETE de realtime no llevan
-- las columnas viejas de la fila -> el filtro del canal (house_id/list_id de
-- la suscripción) no se podía evaluar -> Supabase descartaba el evento -> el
-- cliente nunca refetcheaba y la fila borrada seguía visible ("la X no borra",
-- "sobrescribe el anterior").
-- Solución: replica identity full en TODAS las tablas de la publicación
-- supabase_realtime para que DELETE (y UPDATE) incluyan todas las columnas y
-- el filtro del canal sea evaluable.

alter table public.expenses replica identity full;
alter table public.appointments replica identity full;
alter table public.appointment_kinds replica identity full;
alter table public.shopping_lists replica identity full;
alter table public.shopping_items replica identity full;
alter table public.categories replica identity full;
alter table public.contacts replica identity full;
alter table public.casa_members replica identity full;