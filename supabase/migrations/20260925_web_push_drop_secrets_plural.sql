-- El RPC que devolvía los tres secretos de golpe se sustituyó por
-- push_service_secret(text), que pide uno a uno. Se retira el anterior: sin este
-- drop seguiría vivo en la base y, en un rebuild, volvería a existir.
--
-- La creación de push_service_secret y su revoke ya están en
-- 20260925_web_push_cron.sql; este fichero solo limpia.
drop function if exists public.push_service_secrets();
