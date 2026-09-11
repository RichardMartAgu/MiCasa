# 🏠 MiCasa

[![CI](https://github.com/RichardMartAgu/MiCasa/actions/workflows/ci.yml/badge.svg)](https://github.com/RichardMartAgu/MiCasa/actions/workflows/ci.yml)

Aplicación móvil para gestionar tu hogar entre varias personas, con coste cero.

MiCasa te permite llevar la **contabilidad de compras** por secciones (Bebé, Reformas, Comida…), gestionar **citas** (médico, escuela, mascotas…), crear **listas de la compra** y recordar los **cumpleaños** de la familia — todo con varios usuarios compartiendo la misma casa en tiempo real.

---

## ✨ Funcionalidades

- **Autenticación** con correo y contraseña (Supabase Auth).
- **Casas multi-usuario**: crea una casa, comparte su código de invitación y toda tu pareja/familia gestiona los mismos datos en tiempo real.
- **Gastos con secciones**: categorías con color, icono y presupuesto mensual, barras de progreso y aviso cuando se supera el presupuesto.
- **Citas**: tipo (médico, escuela, mascota…), persona, lugar, fecha y hora.
- **Listas de la compra**: artículos con cantidad, marcado de completado y listas terminadas.
- **Cumpleaños**: contactos con fecha de nacimiento y widget de «próximos 30 días».
- **Tiempo real**: los cambios de cualquier miembro se reflejan al instante (Supabase Realtime).
- **Seguridad**: Row Level Security en toda la base de datos.

## 🧱 Stack

| Capa | Tecnología |
| --- | --- |
| Móvil | [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) (React Native 0.86, React 19, TypeScript) |
| Navegación | expo-router (file-based) |
| Backend | [Supabase](https://supabase.com) (PostgreSQL + Auth + Realtime) |
| Tests | Jest + jest-expo |

## 🚀 Puesta en marcha

### 1. Crear el proyecto en Supabase (gratis)

1. Crea una cuenta y un proyecto en [supabase.com](https://supabase.com).
2. Abre **SQL Editor** y ejecuta el contenido de [`supabase/schema.sql`](supabase/schema.sql). Esto crea tablas, índices, triggers, políticas de seguridad y Realtime.
3. En **Project Settings → API** copia la `Project URL` y la `anon public key`.

### 2. Configurar el entorno

```bash
cp .env.example .env
```

Rellena `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` en `.env`.

### 3. Instalar y ejecutar

```bash
npm install
npm start        # escanea el QR con la app Expo Go
npm run web      # o pruébala en el navegador
npm run android  # emulador Android
```

## 🧪 Calidad

```bash
npm test          # 196 tests unitarios (Jest)
npm run typecheck # TypeScript estricto
npm run lint      # ESLint (config de Expo)
```

La lógica pura de negocio (validación, fechas, finanzas y cumpleaños) está aislada en `src/lib/` y cubierta por tests en `__tests__/`.

## 📁 Estructura

```
src/
├── app/                 # Rutas de expo-router
│   ├── (tabs)/          # Pantallas principales (Inicio, Citas, Gastos, Listas, Cumpleaños, Ajustes)
│   ├── _layout.tsx      # Providers (Auth, Casa) + Stack
│   ├── login.tsx
│   └── register.tsx
├── components/
│   ├── expenses/        # ExpenseForm, CategoryManager, ExpenseList
│   └── ui/              # Button, Card, TextField, EmptyState
├── constants/theme.ts   # Colores y espaciados
├── context/             # AuthProvider y CasaProvider (casa actual, miembros)
├── hooks/               # useRealtimeCollection (fetch + suscripción Realtime)
└── lib/                 # Lógica pura testeable + capa de datos
    ├── validation.ts    # Validaciones de formularios
    ├── date.ts          # Utilidades de fechas
    ├── finance.ts       # Agregación de gastos y presupuestos
    ├── birthdays.ts     # Próximos cumpleaños
    ├── format.ts        # Moneda, iniciales, códigos
    ├── api.ts           # Capa de datos tipada sobre Supabase
    └── supabase.ts      # Cliente Supabase
```

## 🗄️ Modelo de datos

- `profiles` — perfil de cada usuario.
- `casas` — hogares, con `invite_code` para compartir.
- `casa_members` — relación usuario ↔ casa (rol owner/member).
- `categories` — secciones de gasto (nombre, color, icono, presupuesto).
- `expenses` — gastos con importe, sección y fecha.
- `appointments` — citas con tipo, persona, lugar y hora.
- `shopping_lists` / `shopping_items` — listas de la compra.
- `contacts` — contactos con fecha de nacimiento.

Todas las tablas tienen **Row Level Security**: solo los miembros de una casa pueden leer/escribir sus datos.

## 🗺️ Siguientes pasos sugeridos

- Notificaciones push de recordatorios (citas y cumpleaños) con `expo-notifications`.
- Subida de justificantes/fotos de gastos a Supabase Storage.
- Presupuestos compartidos y alertas por sección.
- Vista de gastos por mes con gráficos.
- Soporte multi-moneda.
