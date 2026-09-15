# Plan: Sincronización de Cumpleaños con Calendario del Dispositivo

## Objetivo

Crear eventos recurrentes anuales (RRULE:FREQ=YEARLY) por contacto en el calendario del dispositivo. Si el usuario tiene Google Calendar vinculado al teléfono, los eventos se sincronizan automáticamente via OS (iOS EventKit / Android AccountManager).

## Opción seleccionada

**Expo Calendar (nativo)** como MVP + **Deep Link** opcional para web.

### Por qué no Google Calendar API (server-side)

- Re-autenticar usuario con scope `calendar.events` (rompe flujo login actual).
- Guardar `provider_refresh_token` en Supabase auth identities.
- Edge Function con client secret de Google Cloud Console.
- Bloque 3-5 días vs 1 día para Expo Calendar.
- Richard usa móvil → sync automática vía OS cubre 90%.

## Contexto actual

### Schema contacts (Supabase)

```sql
-- supabase/schema.sql:119-128
CREATE TABLE public.contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  casa_id     uuid NOT NULL REFERENCES public.casas(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name        text NOT NULL,
  birth_date  date NOT NULL,
  relationship text,
  phone       text,
  created_at  timestamptz DEFAULT now()
);
```

- RLS: member select/insert/update/delete (`schema.sql:419-431`).
- Sin cambios necesarios en schema.

### Lógica birthday existente

- `src/lib/birthdays.ts`: `upcomingBirthdays()`, `nextBirthday()`, `ageOn()`, `birthdayLabel()`.
- `src/app/(tabs)/cumpleanos.tsx`: CRUD contactos, muestra próximos 30 días + resto.
- `src/app/(tabs)/index.tsx`: Widget "Próximos cumpleaños" en home.

## Cambios necesarios

### 1. Instalar dependencia

```bash
npx expo install expo-calendar
```

### 2. Configurar plugins y permisos (`app.json`)

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      ["expo-splash-screen", { ... }],
      "@react-native-community/datetimepicker",
      [
        "expo-calendar",
        {
          "calendarPermission": "MiCasa necesita acceso a tu calendario para crear eventos de cumpleaños.",
          "contactsPermission": "MiCasa necesita acceso a tus contactos para sincronizar cumpleaños."
        }
      ]
    ]
  }
}
```

### 3. Nueva librería: `src/lib/calendar-sync.ts`

Responsabilidades:
- `requestCalendarPermissions()`: pide permisos READ+WRITE calendar.
- `getOrCreateBirthdayCalendar()`: busca o crea calendario "MiCasa Cumpleaños" en el dispositivo.
- `createBirthdayEvent(contact, calendarId)`: crea evento recurrente anual por contacto.
- `syncAllBirthdays(contacts, calendarId)`: sincroniza todos los contactos (evita duplicados por title+startDate).
- `deleteBirthdayEvent(eventId)`: elimina evento si contacto se borra.
- `syncBirthdays(contacts)`: flujo completo: permisos → calendario → sync.

SDK 57 usa nueva API de clases (`ExpoCalendar`, `ExpoCalendarEvent`). Métodos legacy (`createEventAsync`, etc.) están deprecated.

```typescript
// Ejemplo flujo sync
import * as ExpoCalendar from 'expo-calendar';

export async function syncBirthdays(contacts: Contact[]): Promise<{ synced: number; errors: number }> {
  const { status } = await ExpoCalendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return { synced: 0, errors: 0 };

  const calendars = await ExpoCalendar.getCalendarsAsync(EXPO_CALENDAR.EntityTypes.EVENT);
  const defaultCal = calendars.find(c => c.source.type === 'LOCAL') ?? calendars[0];
  if (!defaultCal) return { synced: 0, errors: 0 };

  let synced = 0;
  let errors = 0;
  for (const contact of contacts) {
    try {
      await createBirthdayEvent(contact, defaultCal.id);
      synced++;
    } catch {
      errors++;
    }
  }
  return { synced, errors };
}
```

### 4. UI: Tab Cumpleaños (`src/app/(tabs)/cumpleanos.tsx`)

Añadir botón "Sincronizar con calendario" en el header (junto al FAB existente).

```typescript
// Nuevo: botón sync en header
<Pressable
  style={styles.syncButton}
  accessibilityRole="button"
  accessibilityLabel="Sincronizar cumpleaños con calendario del dispositivo"
  onPress={handleSync}>
  <Ionicons name="sync-outline" size={20} color={Palette.primary} />
</Pressable>
```

Flujo handleSync:
1. Llama `syncBirthdays(contacts)`.
2. Muestra alerta: "X cumpleaños sincronizados. Y errores."
3. Opcional: guarda flag `calendarSyncEnabled: true` en AsyncStorage para auto-sync futuro.

### 5. Deep Link para web (src/app/(tabs)/cumpleaños.tsx)

Añadir botón "Añadir a Google Calendar" por contacto en la card.

```typescript
// Deep link por contacto
function openGoogleCalendar(contact: Contact, birthDate: Date) {
  const title = encodeURIComponent(`🎂 Cumpleaños de ${contact.name}`);
  const date = birthDate.toISOString().split('T')[0].replace(/-/g, '');
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${date}/${date}&recur=RRULE:FREQ=YEARLY`;
  Linking.openURL(url);
}
```

### 6. Tests

- `src/lib/__tests__/calendar-sync.test.ts`:
  - `createBirthdayEvent` crea evento con RRULE YEARLY.
  - `syncAllBirthdays` evita duplicados por title+startDate.
  - Permisos denegados retorna `{ synced: 0, errors: 0 }`.
  - Contacto sin birth_date se salta (ya handled por safeDate).
- `src/app/(tabs)/__tests__/cumpleanos-sync.test.tsx`:
  - Botón sync visible.
  - Al pulsar sync, muestra resultado (mock expo-calendar).

### 7. Actualizar tests existentes

- `__tests__/screens/cumpleanos.test.tsx`: mock de expo-calendar, test botón sync.

## Edge Cases

| Caso | Manejo |
|------|--------|
| Permisos denegados | Alerta "Permiso de calendario necesario. Ve a Ajustes." |
| Sin calendario disponible | Error: "No se encontró calendario en el dispositivo." |
| Contacto sin birth_date | Se salta (ya handled por `safeDate` null check) |
| Duplicados (sync repetido) | Busca por title "🎂 Cumpleaños de {name}" + startDate, crea solo si no existe |
| Contacto eliminado | Elimina evento del calendario si existe (match por title) |
| Sin Google Calendar vinculado | Crea evento en calendario local. Sync con Google ocurre si usuario vincula después |
| iOS sin spinner display | DateTimePicker usa `display: 'default'` en Android, `'spinner'` en iOS (ya implementado) |

## Requisitos de Build

- **NO funciona en Expo Go** — requiere development build (`npx expo prebuild` + dev client).
- Build EAS: `eas build --profile development`.
- Después de MVP, build production para App Store/Play Store incluirá permisos.

## Orden de Implementación

1. Instalar expo-calendar + configurar app.json (5 min).
2. Crear `src/lib/calendar-sync.ts` con lógica sync (30 min).
3. Añadir botón sync en tab cumpleaños (15 min).
4. Deep link por contacto (10 min).
5. Tests unitarios (20 min).
6. Security audit (read-only).
7. QA: typecheck + lint + tests.
8. Commit + PR.

## Coste

$0 — expo-calendar es open source, sin backend, sin secrets, sin API costs.

## Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| SDK 57 nueva API de clases puede cambiar | Medio | Tests cubren flujo principal. Documentar API usada |
| Permisos denegados por usuario | Bajo | Alerta con link a ajustes del dispositivo |
| Duplicados en sync repetido | Bajo | Match por title+startDate antes de crear |
| Eventos no aparecen en Google Calendar | Bajo | Depende de OS. Documentar: usuario debe tener Google Calendar vinculado en ajustes del teléfono |

## Preguntas para Richard (al implementar)

1. ¿Quieres auto-sync al crear/editar contacto, o solo manual con botón?
2. ¿Calendario dedicado "MiCasa Cumpleaños" o mezclar con calendario default?
3. ¿Notificación antes de sync ("Se crearán X eventos en tu calendario") o sync directo?
