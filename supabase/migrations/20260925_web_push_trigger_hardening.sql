-- Endurece el trigger de updated_at creado para las tablas de Web Push:
-- search_path fijo y sin EXECUTE para los roles de la API.

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
drop trigger if exists push_preferences_touch on public.push_preferences;
drop function if exists public.touch_updated_at();

create function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

create trigger push_preferences_touch
  before update on public.push_preferences
  for each row execute function public.touch_updated_at();

revoke all on function public.touch_updated_at() from public, anon, authenticated;
