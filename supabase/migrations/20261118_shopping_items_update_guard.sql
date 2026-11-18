-- Cierra el hueco de `shopping_items_update_member`.
--
-- La política anterior solo validaba `is_casa_member(casa_id)` en USING y en
-- WITH CHECK. Un UPDATE directo por PostgREST podía mover `list_id` a una
-- lista de otra casa, o dejar `casa_id`/`list_id` incoherentes, porque el
-- WITH CHECK no miraba la lista padre. El INSERT ya exigía esa coherencia.
--
-- Se exige en WITH CHECK lo mismo que en INSERT: membresía de la casa de la
-- fila y existencia de la lista padre con el mismo `casa_id`. El USING se
-- queda sin subconsulta a propósito: si la subconsulta, el cascade delete de
-- la lista falla porque el padre ya no existe al filtrar los hijos (ver
-- 20260917_fix_shopping_items_cascade.sql y el comentario de schema.sql).
--
-- Idempotente: `drop policy if exists` + `create policy` deja la política
-- exactamente igual en cada reejecución.

drop policy if exists "shopping_items_update_member" on public.shopping_items;

create policy "shopping_items_update_member" on public.shopping_items
  for update using (public.is_casa_member(casa_id))
  with check (
    public.is_casa_member(casa_id)
    and exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_items.list_id and sl.casa_id = shopping_items.casa_id
    )
  );
