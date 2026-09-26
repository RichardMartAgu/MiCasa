-- El dispatcher se quedaba sin respuesta, y los recordatorios no se enviaban.
--
-- Medido en `net._http_response` antes de este cambio, un 40% de las
-- ejecuciones del cron moría antes de receiving nada:
--
--   18:40  202
--   18:45  202
--   18:50  timeout  "Timeout of 5000 ms reached"
--   18:55  timeout
--   19:00  202
--   19:05  202
--   19:10  timeout
--   19:15  timeout
--
-- La causa no es la función: `net.http_post` aborta a los 5 segundos por
-- defecto, y el camino previo al 202 tiene que crear el cliente con service
-- role, leer el secreto del cron de Vault y leer el par de claves VAPID de
-- Vault. Son tres viajes de red a la base antes de poder contestar. En frío, o
-- con Vault contending, eso se pasa de los 5 s y pg_net se rinde.
--
-- Encolar el trabajo con `waitUntil` ya quitaba el reparto del camino critico,
-- pero no el trabajo previo, y por eso los timeouts seguian. La solucion es
-- decirle a pg_net cuanto puede esperar: la funcion encola y contesta en
-- milisegundos, asi que 30 s es de sobra y solo amplia el margen para el
-- arranque en frio.
--
-- Nota sobre por que no se nota que falla: pg_net registra el timeout como una
-- fila con `status_code` nulo, y el 202 sigue siendo la respuesta mayoritaria.
-- Mirar solo los 202 da la sensacion de que todo va bien.

select cron.unschedule(jobid) from cron.job where jobname = 'dispatch-web-push';

select cron.schedule(
  'dispatch-web-push',
  '*/5 * * * *',
  $$
  -- `app.settings.supabase_url` no está definido en este proyecto, así que se
  -- usa la URL literal como reserva. Evita que un rebuild en otro entorno
  -- dispare contra producción sin querer.
  select net.http_post(
    url := coalesce(
      nullif(current_setting('app.settings.supabase_url', true), ''),
      'https://sxgsqvwvugdklycpqxiu.supabase.co'
    ) || '/functions/v1/send-web-push',
    headers := jsonb_build_object(
      'x-cron-secret', (select public.push_service_secret('push_cron_secret')),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb,
    -- Ver la nota de cabecera. El valor por defecto de pg_net son 5000 ms, y
    -- solo con leer los secretos de Vault esa vez no daba.
    timeout_milliseconds := 30000
  );
  $$
);
