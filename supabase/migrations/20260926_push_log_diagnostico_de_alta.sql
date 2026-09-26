-- Permite que el cliente anote POR QUÉ falló su propio alta de avisos.
--
-- Contexto: en Android el alta fallaba con "suscripción incompleta" sin más
-- detalle. La falta de ese detalle convirtió el diagnóstico en adivinar, y dos
-- arreglos sucesivos salieron de suposiciones equivocadas. Con el motivo
-- registrado se puede leer en la base qué devuelve el navegador sin depender de
-- que nadie describa lo que ve.
--
-- Superficie: deliberadamente mínima.
--   - Solo INSERT, no UPDATE ni DELETE. El usuario no puede reescribir el
--     histórico de envíos ni borrar marcas de idempotencia.
--   - Solo filas propias (`user_id = auth.uid()`), igual que el resto de tablas.
--   - Solo claves con el prefijo `alta:`. `push_log` es la tabla de idempotencia
--     de los envíos reales, cuyas claves son `tipo:id:slot:dia` y
--     `test:user:bucket`: si el cliente pudiera escribir esas, podría hacer que
--     un recordatorio suyo se perdiera.
--   - Longitud acotada por el `check` ya existente en la tabla.
--
-- No se guarda nada de la suscripción: ni endpoint, ni p256dh, ni auth. Solo el
-- motivo, que es un valor de un conjunto cerrado y no un dato del navegador.

create policy "push_log_insert_own_alta" on public.push_log
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and dedupe_key like 'alta:%'
    and char_length(dedupe_key) <= 200
  );

comment on policy "push_log_insert_own_alta" on public.push_log is
  'El cliente solo puede anotar el motivo de un fallo de su propio alta de avisos, con clave "alta:". No puede escribir las claves de idempotencia de los envíos reales, ni reescribir o borrar marcas de otros.';
