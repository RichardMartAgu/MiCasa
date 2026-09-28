-- Web Push: acceso a secretos y programación del dispatcher.
--
-- Hasta ahora `push_service_secrets` y el job de pg_cron solo existían en el
-- SQL Editor. Este fichero los deja versionados para que el repositorio sea la
-- fuente de verdad del esquema: cualquier rebuild o entorno nuevo los reproduce.
--
-- Por qué el RPC no puede ser legible por la API: devuelve la clave privada
-- VAPID y el secreto que autentica a pg_cron. Con ellos se puede enviar push a
-- cualquier navegador suscrito. Se revoca de public, anon y authenticated, y
-- solo queda para service_role.

create extension if not exists pg_net with schema extensions;

-- La primera versión de este bloque usaba un RPC que devolvía los tres secretos
-- de golpe. Se sustituye por el de uno en uno, así que la anterior se retira:
-- sin este drop seguiría viva en la base y, en un rebuild, volvería a existir.
drop function if exists public.push_service_secrets();

-- ---------------------------------------------------------------------------
-- Secreto por nombre, en vez de los tres de golpe.
-- ---------------------------------------------------------------------------
create or replace function public.push_service_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = secret_name
    and secret_name in ('vapid_public_key', 'vapid_private_key', 'push_cron_secret');
$$;

revoke all on function public.push_service_secret(text) from public, anon, authenticated;
grant execute on function public.push_service_secret(text) to service_role;

-- El dispatcher se autentica con el secreto; el resto lo lee la Edge Function.
comment on function public.push_service_secret(text) is
  'Lee un secreto de Supabase Vault. Solo service_role. Con la VAPID privada o el secreto del cron en manos ajenas se puede controlar el push de todos los usuarios.';

-- ---------------------------------------------------------------------------
-- Estado de la suscripción: solo lo escribe la Edge Function.
--
-- Sin esto, un usuario podía ponerse a sí mismo `active = true` después de que
-- el dispatcher lo hubiera marcado inactivo, o resets a cero `failure_count`
-- para saltarse el corte tras varios fallos.
-- ---------------------------------------------------------------------------
create or replace function public.protect_push_subscription_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    new.active := old.active;
    new.failure_count := old.failure_count;
    new.last_success_at := old.last_success_at;
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscriptions_state_guard on public.push_subscriptions;
create trigger push_subscriptions_state_guard
  before update on public.push_subscriptions
  for each row execute function public.protect_push_subscription_state();

revoke all on function public.protect_push_subscription_state() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- pg_net guarda en cola la petición, con sus cabeceras, hasta que el worker la
-- envía. Eso incluye el secreto del dispatcher, en `net.http_request_queue`.
--
-- Los privileges de `net` en los proyectos de Supabase vienen de PUBLIC y los
-- vuelve a otorgar la plataforma: revocar aquí no aguanta (comprobado en
-- producción, 2026-09-25). La mitigación real es que `net` no está en los
-- esquemas expuestos de PostgREST (`pgrst.db_schemas` sin definir, por tanto
-- solo `public` y `graphql_public`), así que la API no puede servir esas
-- tablas. Si algún día se añade `net` a los esquemas expuestos, hay que volver
-- a mirarlo: con eso, cualquier cliente con la anon key leería el secreto.
-- ---------------------------------------------------------------------------
revoke all on schema net from public;
revoke all on all tables in schema net from public;
grant usage on schema net to postgres, supabase_admin, service_role, authenticator;
grant all on all tables in schema net to postgres, supabase_admin, service_role, authenticator;

-- ---------------------------------------------------------------------------
-- Dispatcher: cada 5 minutos busca los recordatorios de las 09:00 locales que
-- siguen pendientes y los envía. El secreto se lee de Vault en tiempo de
-- ejecución, así que no queda escrito en cron.job.
-- ---------------------------------------------------------------------------
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
    body := '{}'::jsonb
  );
  $$
);
