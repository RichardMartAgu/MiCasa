# Normas de avisos

Estado: vigente desde 2026-10-27. Aplica a avisos in-app, notificaciones
locales, Web Push, email transaccional y Telegram manual. No aplica a mensajes
de validación, errores de formulario ni estado de pantalla; esos no son avisos.

## 1. Definiciones

- **Aviso**: mensaje que interrumpe o espera al usuario fuera del flujo normal.
- **Canal**: in-app, local, Web Push, email o Telegram.
- **Preferencia**: decisión guardada de recibir o no un tipo de aviso.
- **Audiencia**: quién puede ver un aviso: su autor (`me`) o toda la casa (`all`).
- **Slot**: momento fijo de un recordatorio (`day-before`, `same-day`) o libre
  (`custom`, pendiente de implementar).

## 2. Canales

| Canal | Uso | Regla |
|---|---|---|
| Aviso in-app (`showNotice`) | Resultado de una acción, un solo mensaje | No interrumpe. Nunca `Alert` en web. |
| Diálogo in-app (`confirmDialog`) | Confirmación destructiva o varios botones | Solo cuando hacen falta botones. |
| Notificación local (`expo-notifications`) | Recordatorios en nativo | La programa el dispositivo, no el servidor. |
| Web Push | Recordatorios en web/PWA | La programa el servidor con `pg_cron` y `send-web-push`. |
| Email transaccional (Resend) | Auth, invitación, bienvenida, recordatorios y presupuesto | Solo transaccional. Nada de marketing sin opt-in. |
| Telegram | Aviso manual | Solo si el usuario lo pide en ese momento. |

`send-email` existe en Supabase, pero la app todavía no lo llama para avisos de
producto. Mientras no se conecte, no se promete email automático.

## 3. Consentimiento

- Push **apagado hasta opt-in explícito**. No pedir permiso al arrancar la app.
- Pedir permiso solo desde Ajustes o tras una acción que justifique el aviso.
- Nativo: interruptor maestro local `notifications_enabled`, por dispositivo.
- Web: `push_preferences.enabled` es global de la cuenta y hace falta además el
  opt-in local del navegador (`micasa:web-push:opt-in`). Apagar en un navegador
  apaga los avisos web de esa cuenta.
- iPhone: Web Push exige PWA instalada. Mostrar aviso de instalación; no fingir
  soporte ni pedir un permiso que el navegador no puede conceder.
- Cerrar sesión da de baja la suscripción push de ese navegador.
- Desactivar avisos debe cancelar lo pendiente y no resucitar la suscripción al
  abrir la app.

## 4. Preferencias y valores

- Citas: `reminder_choice` por cita.
- Cumpleaños: `birthday_choice` por usuario.
- Nevera: `fridge_choice` por usuario.
- Valores: `none` | `day-before` | `same-day` | `both`.
- Aviso de cita personalizado: `custom`, con `reminder_at` obligatorio. Día y
  hora libres, siempre antes de que empiece la cita, editables.
- Valor desconocido se trata como `none` o `me`, nunca como una audiencia mayor.
- Un valor no elegido no se pinta como elegido. Si no se sabe leer, el selector
  queda sin marcar (`null`), no en `none`.

### Defaults actuales y desviación

- Cita: `reminder_choice = 'none'`, `notify_audience = 'me'`.
- Nativo: cumpleaños `none`, nevera `none`.
- Web: la fila `push_preferences` nace con `enabled = true`,
  `birthday_choice = 'both'` y `fridge_choice = 'none'`. El opt-in por navegador
  impide enviar hasta que se activa, pero al activarlo cumpleaños queda en
  `both` sin elección explícita.
- **Desviación a corregir**: `push_preferences.birthday_choice` debería nacer en
  `none` para que la norma de consentimiento se cumpla también en web.

## 5. Audiencia

- `me` = solo autor. `all` = toda la casa. `me` es el default.
- Servidor filtra por pertenencia a la casa: un exmiembro no recibe avisos de
  una casa que ya no es suya.
- Cliente falla cerrado sin `viewerId`; el servidor siempre debe pasar el
  usuario que mira. Sin usuario no se concede audiencia.
- Un aviso `all` no puede revelar datos privados de quien lo creó.
- Cambiar audiencia es acto explícito; nunca se amplía sola.

## 6. Horario y entrega

- Slots fijos: **09:00 hora local** del usuario, no del servidor.
- `day-before`: ventana de catchup de 180 minutos.
- `same-day`: se puede entregar desde las 09:00 hasta que empiece el evento.
- Cron cada 5 minutos. Nunca ráfagas ni repeticiones cada hora.
- Deduplicación obligatoria en `push_log`. Reserva sin entrega se reclama una
  sola vez pasados 15 minutos. Retención de `push_log`: 30 días.
- Aviso personalizado (aprobado, pendiente): instante exacto elegido por el
  usuario; si no se puede entregar a esa hora, se entrega hasta que empiece la
  cita. Editar la hora puede generar un aviso nuevo; no es duplicado.
- No hay silencio nocturno implementado. El horario fijo de 09:00 es la única
  protección actual; añadir franja nocturna queda como decisión pendiente.

## 7. Contenido y privacidad

- Título claro y cuerpo autosuficiente: qué pasa, cuándo y dónde.
- Saneado obligatorio: quitar marcas bidireccionales, ancho cero y caracteres de
  control. Un nombre de miembro no puede falsificar un aviso.
- No meter importes, diagnósticos ni datos sensibles en la notificación visible
  en pantalla bloqueada. Dato mínimo necesario.
- Español, tono directo. Sin urgencia falsa ni signos de exclamación.
- Enlaces de push solo a rutas de la allowlist (`ALLOWED_PUSH_ROUTES`), con
  comparación exacta, nunca por prefijo.
- Contenido de cita personalizada: hora exacta en la zona del destinatario.

## 8. Fallos

- Un fallo de aviso no bloquea la acción principal: primero se guarda, después
  se programa.
- Web Push:
  - `410` o suscripción inválida: borrar suscripción.
  - `23505` en carrera entre pestañas: releer y tratar como éxito si la fila es
    propia.
  - Fallo de red: no reintentar en bucle; anotar en `push_log`.
- Interruptor y realidad deben coincidir. Suscripción muerta con interruptor
  encendido es un bug: reconciliar al arrancar.
- Errores internos a consola/log. Al usuario solo errores accionables.

## 9. Pruebas

- Aviso nuevo exige tests de fechas, slots, zona horaria, audiencia, saneado y
  deduplicación.
- Nativo: `npx jest`. Web Push: `npm run check:functions` y
  `npm run test:functions`. PWA: `npm run verify:pwa` si toca web o service
  worker.
- Botón de aviso de prueba para verificar entrega real.
- No dar por terminado un aviso sin probar en navegador o dispositivo real
  cuando el cambio toca push.
- Cambio en `src/lib/notification-schedule.ts` obliga cambio espejo en
  `supabase/functions/send-web-push/reminders.ts`.

## 10. Prohibiciones

- Pedir permiso de notificaciones al abrir la app.
- Enviar a exmiembros de una casa.
- Reactivar una suscripción que el usuario apagó.
- Usar un aviso para decir algo que debería estar en pantalla.
- Llamar a `scripts/notify-telegram.sh` sin petición explícita.
- Hardcodear secretos. VAPID y `RESEND_API_KEY` viven en Vault o secrets.
- Ampliar audiencia o activar un aviso sin acción explícita del usuario.

## 11. Pendientes

1. Implementar aviso de cita personalizado (`custom`).
2. Alinear `push_preferences.birthday_choice` por defecto a `none`.
3. Decidir franja de silencio nocturno.
4. Decidir si gastos y presupuesto entran en estas normas o solo por email.
5. Conectar `send-email` a la app o retirar la promesa de email automático.
