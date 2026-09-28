-- El motivo de un fallo de alta va en la clave, no en una columna de texto, y
-- hasta ahora la política solo comprobaba el prefijo "alta:". Eso dejaba que
-- cualquier cliente con el JWT de un usuario escribiera "alta:<lo que sea>",
-- sin límite de volumen y con `sent_at` a su antojo, y sobre todo dejaba meter
-- basura en la única tabla de la que se lee el diagnóstico.
--
-- Se cierra con el conjunto real de motivos y con el sello de tiempo puesto por
-- la base. El coste de cerrarlo es que un motivo nuevo que no esté en la lista
-- no se escribe, así que hay un test que comprueba que las dos listas
-- (IncompleteReason y SubscribeFailure) están dentro de la política:
-- `__tests__/lib/web-push.test.ts`, "el conjunto de motivos de la política de
-- push_log".

drop policy if exists "push_log_insert_own_alta" on public.push_log;

create policy "push_log_insert_own_alta" on public.push_log
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and dedupe_key ~ '^alta:(sin-endpoint|sin-claves|sin-p256dh|sin-auth|sin-servicio-push|permiso|worker-inactivo|clave-invalida|desconocido):[0-9]{14}$'
    and sent_at = now()
  );

comment on policy "push_log_insert_own_alta" on public.push_log is
  'El cliente solo puede anotar el motivo de un fallo de su propio alta de avisos, y solo con un motivo del conjunto cerrado y el sello de tiempo que pone la base. No puede escribir las claves de idempotencia de los envíos reales, ni reescribir o borrar marcas de otros.';
