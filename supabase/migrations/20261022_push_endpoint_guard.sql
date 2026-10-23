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

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_host
  check (
    endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com)/'
  );

create or replace function public.limit_push_subscriptions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*)
      from public.push_subscriptions
     where user_id = new.user_id
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
