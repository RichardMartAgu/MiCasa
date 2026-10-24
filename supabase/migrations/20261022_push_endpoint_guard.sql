-- Cierra dos riesgos de `push_subscriptions` que el reparto con service role
-- convertía en superficie de red:
--
-- 1. `endpoint` era texto libre. Cualquier usuario autenticado podía insertar
--    endpoints HTTPS arbitrarios y el cron hacía `POST` a todos en cada vuelta
--    (SSRF ciego y amplificación de peticiones). Solo se admiten los servicios
--    push reales de los navegadores soportados.
-- 2. Sin tope por usuario, un solo usuario podía llenar la tabla y multiplicar
--    los envíos. Diez navegadores por cuenta es holgado para el uso real.
--
-- Los CHECK/trigger no cambian RLS: cada uno sigue viendo y escribiendo solo lo
-- suyo. Las filas existentes (FCM y Mozilla) cumplen el patrón.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'push_subscriptions_endpoint_host'
      and conrelid = 'public.push_subscriptions'::regclass
  ) then
    -- `NOT VALID` + `VALIDATE` en vez de `ADD CONSTRAINT` a secas: si entra una
    -- fila mala entre la revisión y el deploy, se ve en el `VALIDATE` y no deja
    -- la migración a medias. Reejecutarla tampoco falla por constraint existente.
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_host
      check (
        endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com)/'
      ) not valid;

    alter table public.push_subscriptions
      validate constraint push_subscriptions_endpoint_host;
  end if;
end;
$$;

create or replace function public.limit_push_subscriptions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serializa las altas del mismo usuario: dos pestañas a la vez leían 9 y
  -- acababan en 11. El lock se libera al terminar la transacción.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  -- Solo cuentan las activas: una fila apagada por fallos no debe impedir que
  -- el usuario vuelva a activar los avisos en otro navegador.
  if (
    select count(*)
      from public.push_subscriptions
     where user_id = new.user_id
       and active
  ) >= 10 then
    raise exception 'demasiadas suscripciones push para este usuario';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_push_subscriptions() from public, anon, authenticated;

drop trigger if exists limit_push_subscriptions on public.push_subscriptions;
create trigger limit_push_subscriptions
  before insert on public.push_subscriptions
  for each row execute function public.limit_push_subscriptions();
