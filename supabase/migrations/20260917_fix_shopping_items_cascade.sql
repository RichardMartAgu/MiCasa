-- Fix: borrar lista de la compra fallaba.
-- Causa: RLS de shopping_items consultaba el padre (shopping_lists) en cada
-- operación; en el cascade delete del padre, el padre ya no existía y el RLS
-- de los hijos bloqueaba el borrado.
-- Solución: casa_id denormalizado en shopping_items + políticas por operación.

alter table public.shopping_items drop constraint if exists shopping_items_casa_id_fkey;
alter table public.shopping_items add column if not exists casa_id uuid
  references public.casas (id) on delete cascade;

update public.shopping_items si
set casa_id = sl.casa_id
from public.shopping_lists sl
where si.list_id = sl.id and si.casa_id is null;

alter table public.shopping_items alter column casa_id set not null;

create index if not exists idx_shopping_items_casa on public.shopping_items (casa_id);

drop policy if exists "shopping_items_all_member" on public.shopping_items;
drop policy if exists "shopping_items_select_member" on public.shopping_items;
drop policy if exists "shopping_items_insert_member" on public.shopping_items;
drop policy if exists "shopping_items_update_member" on public.shopping_items;
drop policy if exists "shopping_items_delete_member" on public.shopping_items;

create policy "shopping_items_select_member" on public.shopping_items
  for select using (public.is_casa_member(casa_id));

create policy "shopping_items_insert_member" on public.shopping_items
  for insert with check (
    public.is_casa_member(casa_id)
    and exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_items.list_id and sl.casa_id = shopping_items.casa_id
    )
  );

create policy "shopping_items_update_member" on public.shopping_items
  for update using (public.is_casa_member(casa_id))
  with check (public.is_casa_member(casa_id));

create policy "shopping_items_delete_member" on public.shopping_items
  for delete using (public.is_casa_member(casa_id));