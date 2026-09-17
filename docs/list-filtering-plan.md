# Plan: Opciones de Filtrado para Listas

## Objetivo

Añadir búsqueda y filtros a las 3 pantallas principales con listas: Gastos, Citas y Cumpleaños. Componentes reutilizables, filtrado client-side, diseño consistente.

## Contexto actual

### Listas en el proyecto

| Pantalla | Tabla Supabase | Sorting actual | Filtrado actual |
|---|---|---|---|
| Gastos (`gastos.tsx`) | `expenses` + `categories` | `spent_at` desc | Solo mes actual (Home) |
| Citas (`citas.tsx`) | `appointments` | `starts_at` asc/desc | Solo futuras vs anteriores |
| Cumpleaños (`cumpleanos.tsx`) | `contacts` | `name` asc | Solo "próximos 30 días" vs resto |

### Componentes UI existentes

- `Card` (`src/components/ui/card.tsx`) — contenedor base, usado en todas las pantallas
- `EmptyState` (`src/components/ui/empty-state.tsx`) — estados vacíos
- `ListItem` (`src/components/ui/list-item.tsx`) — genérico, **no usado actualmente**
- `ExpenseList` (`src/components/expenses/expense-list.tsx`) — render puro, sin filtrado

### Sin componentes de filtro/búsqueda

No existe `SearchBar`, `FilterChips`, `SortControl` ni similar en el proyecto.

## Alcance

### Pantallas afectadas

1. **Gastos** — más datos, más filtros necesarios
2. **Citas** — tipo, persona, búsqueda
3. **Cumpleaños** — parentesco, búsqueda

### Tipo de filtros por pantalla

#### Gastos
- **Barra de búsqueda** — filtra por `title` (expenses) y `name` (categories)
- **Chips de categoría** — filtra por `category_id`, muestra nombre + color de `categories`
- **Filtro de fechas** — "este mes", "este año", "últimos 3 meses", "todo"

#### Citas
- **Barra de búsqueda** — filtra por `title`, `person`, `location`
- **Chips de tipo** — filtra por `kind` (médico, escuela, mascota, personal, otro)
- **Toggle** — "Próximas" / "Anteriores" / "Todas"

#### Cumpleaños
- **Barra de búsqueda** — filtra por `name`
- **Chips de parentesco** — filtra por `relationship` (familia, amigo, trabajo, otro)

### Enfoque técnico

- **Filtrado client-side** con `useMemo` sobre datos ya cargados
- Sin llamadas extra al API, sin cambios en Supabase queries
- Hooks existentes (`useRealtimeCollection`) ya traen todos los datos
- Componentes nuevos reutilizables en `src/components/ui/`

## Componentes a crear

### 1. `SearchBar` (`src/components/ui/search-bar.tsx`) ✅ creado

TextInput con icono de lupa, debounce de 300ms, botón clear.

```
Props:
- value: string
- onChangeText: (text: string) => void
- placeholder?: string (default 'Buscar')
```

Notas: input local actualiza al instante, `onChangeText` al padre va debounced. Clear emite `''` inmediato. Reset externo de `value` limpia timeout pendiente (fix race MEDIO de QA).

### 2. `FilterChips` (`src/components/ui/filter-chips.tsx`) ✅ creado

Scroll horizontal de chips seleccionables. Selección múltiple opcional.

```
Props:
- options: { label: string; value: string; color?: string }[]
- selected: string | string[]  (string[] si multiple)
- onSelect: (value: string | string[]) => void  (single: string, '' = deseleccionar; multiple: string[])
- multiple?: boolean (default: false)
```

Notas: `onSelect` emite selección completa calculada (array nuevo en multiple, `''` en single al deseleccionar). Opción con `color` → fondo ese color, texto blanco.

### 3. `DateFilter` (`src/components/ui/date-filter.tsx`) ✅ creado

Chips predefinidos para rangos de fechas.

```
Props:
- options?: { label: string; value: string }[] (default: Este mes/this_month, Este año/this_year, Últimos 3 meses/last_3_months, Todo/all)
- selected: string
- onSelect: (value: string) => void  ('' = deseleccionar)
```

### 4. `FilterBar` (`src/components/ui/filter-bar.tsx`) ✅ creado

Contenedor que compone SearchBar + FilterChips + DateFilter.

```
Props:
- search?: { value: string; onChangeText: (t: string) => void; placeholder?: string }
- chips?: FilterChipsProps
- date?: DateFilterProps
- style?: StyleProp<ViewStyle>
```

Composicion condicional: componente se renderiza solo si su prop viene. Gap `Spacing.three` entre grupos.

## Lógica de filtrado (por pantalla)

### Gastos (`gastos.tsx`)

```typescript
const filteredExpenses = useMemo(() => {
  let result = expenses
  if (searchText) {
    result = result.filter(e =>
      e.title.toLowerCase().includes(searchText.toLowerCase())
    )
  }
  if (selectedCategory) {
    result = result.filter(e => e.category_id === selectedCategory)
  }
  if (dateRange) {
    const now = new Date()
    result = result.filter(e => {
      const spent = new Date(e.spent_at)
      switch (dateRange) {
        case 'this_month': return isSameMonth(spent, now)
        case 'this_year': return spent.getFullYear() === now.getFullYear()
        case 'last_3_months': return isWithinInterval(spent, { start: subMonths(now, 3), end: now })
        case 'all': return true
      }
    })
  }
  return result
}, [expenses, searchText, selectedCategory, dateRange])
```

### Citas (`citas.tsx`)

```typescript
const filteredAppointments = useMemo(() => {
  let result = appointments
  if (searchText) {
    const q = searchText.toLowerCase()
    result = result.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.person?.toLowerCase().includes(q) ||
      e.location?.toLowerCase().includes(q)
    )
  }
  if (selectedKind) {
    result = result.filter(e => e.kind === selectedKind)
  }
  return result
}, [appointments, searchText, selectedKind])
```

### Cumpleaños (`cumpleanos.tsx`)

```typescript
const filteredContacts = useMemo(() => {
  let result = contacts
  if (searchText) {
    result = result.filter(c =>
      c.name.toLowerCase().includes(searchText.toLowerCase())
    )
  }
  if (selectedRelationship) {
    result = result.filter(c => c.relationship === selectedRelationship)
  }
  return result
}, [contacts, searchText, selectedRelationship])
```

## Orden de implementación

### Bloque 1: Componentes UI reutilizables (front) ✅ COMPLETADO
1. `SearchBar` — TextInput + icono + debounce (fix race reset externo aplicado)
2. `FilterChips` — scroll horizontal + selección
3. `DateFilter` — chips predefinidos de fechas
4. `FilterBar` — composición de los 3 anteriores

**Validación:** `npx tsc --noEmit` PASA + `npx expo lint` PASA + `npx jest` PASA (196 tests). **Security: APROBADO. QA: PASA.**

### Bloque 2: Integración en Gastos (front) ✅ COMPLETADO
1. `FilterBar` en `gastos.tsx` (search "Buscar gastos" + chips categorías con color + date default)
2. Estado: `searchText` (''), `selectedCategory` (''), `dateRange` ('all')
3. Lógica extraída a `src/lib/filter.ts` → `filterExpenses(expenses, { search, categoryId, dateRange })` pura
4. Tests: `__tests__/lib/filter.test.ts` (9 casos, fake timers) + 4 tests adaptados en `gastos.test.tsx`

**Validación:** tsc PASA + lint PASA + jest PASA (21 suites / 205 tests). **Security: APROBADO. QA: PASA.**

### Bloque 3: Integración en Citas (front) ✅ COMPLETADO
1. `FilterBar` en `citas.tsx` (search "Buscar citas" + chips de tipo Todos/KINDS)
2. Estado: `searchText` (''), `selectedKind` ('')
3. `filterAppointments` en `src/lib/filter.ts` (search null-safe sobre title/person/location + kind)
4. Filtro aplica antes de particionar upcoming/past
5. Tests: 6 casos en `__tests__/lib/filter.test.ts`

**Validación:** tsc PASA + lint PASA + jest PASA (21 suites / 211 tests). **Security: APROBADO. QA: PASA.**

### Bloque 4: Integración en Cumpleaños (front) ✅ COMPLETADO
1. `FilterBar` en `cumpleanos.tsx` (search "Buscar contactos" + chips de parentesco DINÁMICOS desde valores únicos de `relationship` reales)
2. Estado: `searchText` (''), `selectedRelationship` ('')
3. `filterContacts` en `src/lib/filter.ts` (search por name + relationship con normalización trim)
4. Filtro aplica antes de particionar upcoming/rest
5. Tests: 7 casos en `__tests__/lib/filter.test.ts` (incluye trim mismatch fix)

**Validación:** tsc PASA + lint PASA + jest PASA (21 suites / 218 tests). **Security: APROBADO. QA: PASA.**

### Bloque 5: QA + Security de todos los bloques ✅ COMPLETADO
- Security audit por bloque: Bloque 1 APROBADO, 2 APROBADO, 3 APROBADO, 4 APROBADO
- QA por bloque: Bloque 1 PASA, 2 PASA (tras REVISAR remediado), 3 PASA, 4 PASA
- Hallazgos remediados: race SearchBar (MEDIO), 4 tests rotos gastos (ALTO), trim relationship (funcional)
- Verificación global final: tsc PASA, lint PASA (3 warnings pre-existentes), jest 218/218

## Orden de implementación (flujo de agentes)

Cada bloque sigue el flujo definido en AGENTS.md:
1. `orquestador` asigna a `front`
2. `front` escribe el bloque
3. `security` audita (read-only)
4. `qa-test` valida (typecheck + lint)
5. Bloque completado solo si APROBADO + PASA

## Fuera de alcance (por ahora)

- Filtros server-side / paginación — los datasets son pequeños (< 500 items)
- Sorting desde UI — orden hardcodeado es suficiente por ahora
- Filtros en Home/Dashboard — ya tiene filtrado por fecha
- Filtros en Ajustes — listas muy cortas (< 10 items)
- Persistencia de filtros — se resetean al cambiar de pantalla

## Riesgos

- **Performance en listas grandes** — `useMemo` con 3 filtros podría ser lento con > 1000 items. Mitigación: datasets actuales son pequeños.
- **Diseño inconsistente** — Mitigación: componente `FilterBar` reutilizable, misma UI en las 3 pantallas.
- ** estados de carga** — Los filtros se aplican sobre datos ya cargados, sin estados de carga adicionales.
