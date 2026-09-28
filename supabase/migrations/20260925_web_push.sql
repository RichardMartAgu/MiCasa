-- Web Push: suscripciones, preferencias y registro de envíos.
--
-- Objetivo: que la PWA de MiCasa reciba recordatorios de citas y cumpleaños
-- aunque la app esté cerrada. El service worker solo precachea el shell
-- (ver workbox-config.js); el envío lo hace la Edge Function `send-web-push`
-- disparada por pg_cron.
--
-- Seguridad: `push_subscriptions` contiene endpoints de push, que son
-- credenciales de facto (permiten enviar a ese navegador). Por eso cada
-- usuario solo ve y gestiona los suyos, y ninguna tabla expone datos de
-- otros mediante RLS. `push_log` solo lo escribe la Edge Function con
-- service role; el usuario puede consultarlo para depurar.

-- ============================================================================
-- push_subscriptions
-- ============================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'Europe/Madrid',
  user_agent text,
  active boolean not null default true,
  failure_count integer not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_max check (char_length(endpoint) <= 2048),
  constraint push_subscriptions_timezone_max check (char_length(timezone) <= 64)
);

comment on table public.push_subscriptions is
  'Suscripciones Web Push por navegador. El endpoint es una credencial: solo su propietario puede leerlo o borrarlo.';

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id)
  where active;

-- trigger updated_at (mismo patrón que el resto del esquema)
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- push_preferences: una fila por usuario
-- ============================================================================
create table if not exists public.push_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birthday_choice text not null default 'both',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint push_preferences_birthday_choice_check
    check (birthday_choice in ('none', 'day-before', 'same-day', 'both'))
);

comment on table public.push_preferences is
  'Preferencias de recordatorio que el servidor necesita para enviar avisos fuera del dispositivo. El reminder de citas vive en appointments.reminder_choice.';

drop trigger if exists push_preferences_touch on public.push_preferences;
create trigger push_preferences_touch
  before update on public.push_preferences
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- push_log: idempotencia de envíos
-- ============================================================================
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  constraint push_log_dedupe_key_max check (char_length(dedupe_key) <= 200),
  constraint push_log_user_dedupe_key_key unique (user_id, dedupe_key)
);

comment on table public.push_log is
  'Recordatorio ya enviado. La clave única evita duplicados si pg_cron se solapa o reintenta.';

create index if not exists push_log_sent_at_idx on public.push_log (sent_at);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.push_subscriptions enable row level security;
alter table public.push_preferences enable row level security;
alter table public.push_log enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using ((select auth.uid()) = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "push_preferences_select_own" on public.push_preferences;
create policy "push_preferences_select_own" on public.push_preferences
  for select using ((select auth.uid()) = user_id);

drop policy if exists "push_preferences_insert_own" on public.push_preferences;
create policy "push_preferences_insert_own" on public.push_preferences
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "push_preferences_update_own" on public.push_preferences;
create policy "push_preferences_update_own" on public.push_preferences
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- El usuario puede leer su propio histórico, pero no insertar: solo la
-- Edge Function (service role) escribe en push_log.
drop policy if exists "push_log_select_own" on public.push_log;
create policy "push_log_select_own" on public.push_log
  for select using ((select auth.uid()) = user_id);
