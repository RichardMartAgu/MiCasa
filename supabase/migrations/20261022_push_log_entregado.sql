-- Marca de entrega de los avisos web.
--
-- `push_log` reserva la clave antes de enviar (idempotencia entre réplicas), pero
-- no guardaba si el envío llegó a confirmarse. Si la invocación moría entre la
-- reserva y el envío, la fila quedaba para siempre y los reintentos del cron se
-- saltaban el recordatorio como duplicado. Con `delivered_at` se distingue una
-- reserva en vuelo de un aviso entregado, y una reserva vieja sin confirmar se
-- puede volver a reclamar.
alter table public.push_log
  add column if not exists delivered_at timestamptz;

comment on column public.push_log.delivered_at is
  'Momento en que el push service aceptó el aviso. NULL = reserva sin confirmar.';

-- Una reserva abandonada se puede retomar **una sola vez**. Sin este techo, un
-- fallo persistente al escribir `delivered_at` haría que el aviso se reenviara
-- cada 15 minutos durante toda la ventana de catchup.
alter table public.push_log
  add column if not exists reclaimed_at timestamptz;

comment on column public.push_log.reclaimed_at is
  'Momento en que una reserva abandonada se retomó. Evita reintentos sin fin.';

-- Las filas anteriores a esta migración se marcan como entregadas, incluidas las
-- que pudieran estar en vuelo en el momento del despliegue. Se prefiere perder
-- como mucho un aviso antiguo a reenviar en masa recordatorios que ya salieron:
-- el cron recalcula la misma ventana en cada vuelta.
update public.push_log
   set delivered_at = sent_at
 where delivered_at is null;
