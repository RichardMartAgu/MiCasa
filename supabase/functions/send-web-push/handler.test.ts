/**
 * Comportamiento del handler contra una base de datos que se comporta como ella.
 *
 * Hasta aquí lo único que se probaba del handler era `handle` con el entorno vacío
 * (que responde 401 antes de tocar nada) y un test sobre el fuente. Con estos
 * doubles se puede comprobar lo que de verdad importa en un dispatcher: qué
 * consulta sale, qué se reserva, qué se suelta y qué status sale cuando una lectura
 * falla. Los cuatro hallazgos que motivan este fichero son de esa clase: caminos que
 * solo se ven mirando lo que hace la función cuando la base de datos falla, dice
 * "no" o se queda sin trabajo que hacer.
 *
 * El doble no intenta ser un PostgREST: implementa la cadena de methods que esta
 * función usa y registra lo que se le pide. Las respuestas se dan por tabla y
 * operación, en cola, porque una misma tabla se lee más de una vez en un request
 * (`push_subscriptions` se lee para la zona y para el envío) y cada lectura quiere su
 * propia respuesta.
 *
 * `push_log` sí imita la restricción de unicidad de verdad, porque es la que sostiene
 * los enfriamientos: sin ella, el segundo `insert` de una misma clave se colaría y
 * los tests de deduplicación no probarían nada.
 */
// Especificador en línea como en el resto del módulo. Pasarlo por el import map de
// deno.json se probó y no compensa: deja dos identidades distintas de
// `SupabaseClient` en el grafo y el type-check de `handle` deja de cuadrar.
// deno-lint-ignore no-import-prefix
import { assert, assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { handle } from "./handler.ts";

const FN = "https://proyecto.supabase.co/functions/v1/send-web-push";
const USER = "11111111-1111-4111-8111-111111111111";
const CASA = "22222222-2222-4222-8222-222222222222";
const CONTACTO = "33333333-3333-4333-8333-333333333333";
const CITA = "44444444-4444-4444-8444-444444444444";
const MADRID = "Europe/Madrid";

/**
 * Claves VAPID con la forma que `web-push` exige (65 y 32 bytes en base64url) pero
 * sin valor criptográfico: `sendToUser` las valida antes de cada envío y un texto
 * cualquiera revienta ahí. Los envíos no llegan a hacerse en estos tests (no hay
 * suscripciones a las que mandar nada), así que ninguna clave llega a usarse.
 */
const VAPID_PUBLIC = "A".repeat(87);
const VAPID_PRIVATE = "B".repeat(43);

type Op = "select" | "insert" | "update" | "delete";

interface Call {
  table: string;
  op: Op;
  payload?: Record<string, unknown>;
  eq: Record<string, unknown>;
  /**
   * Filtros de `.in(...)`, aparte de los de `.eq(...)` porque el valor es una lista
   * y mezclarlos haría ambiguo leer una aserción.
   */
  inList: Record<string, unknown[]>;
  lt?: [string, unknown];
  /** `maybeSingle` Was llamado: la respuesta es una fila, no una lista. */
  single?: boolean;
}

interface Answer {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

const SIN_ERROR: Answer = { data: null, error: null };

/** Un resultado de consulta con filas. */
function filas(rows: unknown[]): Answer {
  return { data: rows, error: null };
}

/** Un resultado de consulta que falla, con el código de Postgres que se quiera. */
function fallo(message: string, code?: string): Answer {
  return { data: null, error: { code, message } };
}

/**
 * Constructor de la cadena de PostgREST, limitada a lo que usa la función.
 *
 * Es thenable porque eso es lo que espera la llamada: `await db.from(..).select(..)`
 * y `await db.from(..).select(..).maybeSingle()` tienen que dar `{ data, error }`.
 */
class Query {
  readonly call: Call;

  constructor(call: Call, private readonly db: FakeDb) {
    this.call = call;
  }

  select(_columnas?: string): Query {
    return this;
  }

  insert(payload: Record<string, unknown>): Query {
    this.call.op = "insert";
    this.call.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>): Query {
    this.call.op = "update";
    this.call.payload = payload;
    return this;
  }

  delete(): Query {
    this.call.op = "delete";
    return this;
  }

  eq(columna: string, valor: unknown): Query {
    this.call.eq[columna] = valor;
    return this;
  }

  in(columna: string, valores: unknown[]): Query {
    this.call.inList[columna] = valores;
    return this;
  }

  not(_columna: string, _operador: string, _valor: unknown): Query {
    return this;
  }

  gte(): Query {
    return this;
  }

  lte(): Query {
    return this;
  }

  lt(columna: string, valor: unknown): Query {
    this.call.lt = [columna, valor];
    return this;
  }

  limit(_n: number): Query {
    return this;
  }

  /** Se devuelve `this` y no un resultado: la espera la hace el `await` de quien llama. */
  maybeSingle(): Query {
    this.call.single = true;
    return this;
  }

  then(
    onCumplido: (value: Answer) => unknown,
    onRechazo?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    return Promise.resolve(this.db.answer(this.call)).then(onCumplido, onRechazo);
  }
}

/** Base de datos de mentira: guion por tabla y operación, y un registro de llamadas. */
class FakeDb {
  readonly calls: Call[] = [];
  /** Claves de `push_log` ya insertadas, para el 23505. */
  private readonly insertadas = new Set<string>();
  private readonly guion: Record<string, Answer[]>;

  constructor(guion: Record<string, Answer[]>) {
    this.guion = guion;
  }

  /** Las llamadas que se hicieron contra una tabla, en orden. */
  callsTo(table: string, op?: Op): Call[] {
    return this.calls.filter((c) => c.table === table && (op === undefined || c.op === op));
  }

  /**
   * Cambia la zona de una fila de `push_subscriptions` en el guion.
   *
   * Existe para el caso de una misma persona con dos suscripciones en zonas
   * distintas. `suscripcion()` pone siempre Madrid, porque en el resto de la suite
   * una sola zona es lo que hace falta; aquí hace falta exactamente lo contrario, y
   * meter un parámetro opcional en el helper obligaría a tocar todas las llamadas.
   */
  /** Las zonas que devolverá la consulta de suscripciones, en orden. */
  zonasDeSuscribciones(): string[] {
    const cola = this.guion["push_subscriptions:select"] ?? [];
    const primera = cola[0];
    const datos = primera?.data;
    return Array.isArray(datos) ? datos.map((f) => String((f as Record<string, unknown>).timezone)) : [];
  }

  reemplazarZona(id: string, timezone: string): void {
    for (const [clave, respuestas] of Object.entries(this.guion)) {
      if (!clave.startsWith("push_subscriptions:select")) continue;
      this.guion[clave] = respuestas.map((respuesta) => {
        const datos = respuesta.data;
        if (!Array.isArray(datos)) return respuesta;
        return {
          ...respuesta,
          data: datos.map((fila) => {
            const filaComoObjeto = fila as Record<string, unknown>;
            return filaComoObjeto.id === id ? { ...filaComoObjeto, timezone } : fila;
          }),
        };
      });
    }
  }

  /**
   * Cuántas filas de `push_log` hay de verdad.
   *
   * Hace falta porque `calls` registra el `insert` aunque la restricción de
   * unicidad lo rechace: `from()` apunta la llamada antes de que se sepa el
   * resultado. Contar llamadas no demuestra que quedara fila, y esto es
   * precisamente lo que se quiere demostrar.
   */
  pushLogRows(): number {
    return this.insertadas.size;
  }

  from(table: string): Query {
    const call: Call = { table, op: "select", eq: {}, inList: {} };
    this.calls.push(call);
    return new Query(call, this);
  }

  rpc(nombre: string): Promise<Answer> {
    // Los tests pasan el secreto y las claves por `env`, así que ninguna lectura de
    // Vault debería ocurrir. Si ocurre, se ve aquí en vez de colgarse en la red.
    // Sin `async`: no hay nada que esperar dentro, y esperar sería mentir sobre eso.
    return Promise.resolve(fallo(`el test no debería leer Vault, pero pidió ${nombre}`));
  }

  auth = {
    getUser: (_token: string): Promise<Answer> =>
      Promise.resolve({ data: { user: { id: USER } }, error: null }),
  };

  answer(call: Call): Answer {
    if (call.table === "push_log" && call.op === "insert") {
      const clave = String(call.payload?.dedupe_key ?? "");
      if (this.insertadas.has(clave)) return fallo("duplicate key", "23505");
      this.insertadas.add(clave);
      return SIN_ERROR;
    }
    if (call.table === "push_log" && call.op === "delete" && call.eq.dedupe_key !== undefined) {
      // Sin esto el doble mentía sobre el estado: un `delete` real sí deja la clave
      // libre para volver a insertarla, y aquí se quedaría bloqueada para siempre.
      this.insertadas.delete(String(call.eq.dedupe_key));
      return SIN_ERROR;
    }

    const cola = this.guion[`${call.table}:${call.op}`];
    if (cola === undefined) return fallo(`sin guion para ${call.table}:${call.op}`);
    const answer = cola.length > 1 ? (cola.shift() as Answer) : (cola[0] as Answer);

    // Los filtros de `.eq()` y `.in()` se aplican de verdad a las filas del guion.
    //
    // Antes esto no pasaba y por eso ninguna prueba podía decir nada de los filtros
    // de visibilidad: `.in()` era un no-op, así que un `.in("casa_id", ...)` equivocado
    // o simplemente ausente daba el mismo resultado que uno bien puesto, y el test
    // pasaba igual. Con esto, una cita de otra casa o de otro autor sale como fila
    // inexistente, que es lo que hace Postgres, y quitar el filtro en el handler se ve
    // en un test rojo.
    let data = answer.data;
    if (Array.isArray(data)) {
      data = (data as Record<string, unknown>[]).filter((fila) => {
        for (const [columna, valor] of Object.entries(call.eq)) {
          if (fila[columna] !== valor) return false;
        }
        for (const [columna, valores] of Object.entries(call.inList)) {
          if (!valores.includes(fila[columna])) return false;
        }
        return true;
      });
    }

    // `maybeSingle` de verdad devuelve la fila, no la lista con la fila dentro. Sin
    // esto, `preferences.birthday_choice` sería `undefined` sobre un array y la
    // función leería "sin aviso de cumpleaños" en un caso que sí lo tiene.
    if (call.single && Array.isArray(data)) {
      return { ...answer, data: data[0] ?? null };
    }
    return { ...answer, data };
  }
}

/**
 * Entorno con todo lo que la función necesita para no responder 401 antes de
 * empezar: URL, service role, el secreto del cron y las claves VAPID.
 */
const ENV = {
  get: (name: string): string | undefined =>
    ({
      SUPABASE_URL: "https://proyecto.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      PUSH_CRON_SECRET: "secreto",
      VAPID_PUBLIC_KEY: VAPID_PUBLIC,
      VAPID_PRIVATE_KEY: VAPID_PRIVATE,
    })[name],
};

/** Guion de respuestas por `tabla:operación`, en cola por si se repite la lectura. */
type Guion = Record<string, Answer[]>;

/** Llamada de `mode=now` con sesión, que es el camino de la confirmación. */
function peticionNow(params: Record<string, string> = {}): Request {
  const url = new URL(`${FN}?mode=now&type=birthday&id=${CONTACTO}&timezone=${MADRID}`);
  for (const [clave, valor] of Object.entries(params)) url.searchParams.set(clave, valor);
  return new Request(url, { method: "POST", headers: { authorization: "Bearer sesion" } });
}

async function cuerpo(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Guion de una confirmación de cumpleaños que llega hasta el envío sin destinatario. */
function guionConfirmacion(extra: Guion = {}): FakeDb {
  return new FakeDb({
    // `user_id` y `casa_id` están porque el doble filtra de verdad: sin ellos, el
    // filtro de visibilidad de la propia consulta se comería la fila y todos estos
    // tests pasarían por un 404 en vez de por el camino que quieren comprobar.
    "push_preferences:select": [filas([{ user_id: USER, enabled: true, birthday_choice: "both" }])],
    "casa_members:select": [filas([{ user_id: USER, casa_id: CASA }])],
    "contacts:select": [filas([{ id: CONTACTO, casa_id: CASA, name: "Lucía", birth_date: "1990-06-20" }])],
    "push_subscriptions:select": [filas([])],
    ...extra,
  });
}

/**
 * Guion de una confirmación de cita: misma forma, con `appointments` en vez de
 * `contacts`. `overrides` sustituye una fila por otra, que es como se expresan los
 * casos de visibilidad: la fila existe en la base pero el filtro no la deja pasar.
 */
function guionCita(extra: Guion = {}): FakeDb {
  return new FakeDb({
    "push_preferences:select": [filas([{ user_id: USER, enabled: true, birthday_choice: "both" }])],
    "casa_members:select": [filas([{ user_id: USER, casa_id: CASA }])],
    "appointments:select": [filas([citaDe(USER, CASA, "both")])],
    "push_subscriptions:select": [filas([])],
    ...extra,
  });
}

/** Una cita tal y como la lee `runNowPush`. */
function citaDe(userId: string, casaId: string, reminderChoice: unknown): Record<string, unknown> {
  return {
    id: CITA,
    user_id: userId,
    casa_id: casaId,
    title: "Dentista",
    starts_at: "2026-03-20T10:00:00Z",
    reminder_choice: reminderChoice,
  };
}

// ---------------------------------------------------------------------------
// El enfriamiento de `mode=now`: sin suscripciones no se puede repetir en bucle.
// ---------------------------------------------------------------------------

Deno.test("sin suscripciones activas la confirmación no se puede reintentar en bucle", async () => {
  const db = guionConfirmacion();
  const res = await handle(peticionNow(), ENV, { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 });

  // El motivo sigue siendo "no hay suscripciones", y ahora además dice cuándo
  // reintentar, que es lo que la persona puede hacer.
  assertEquals(res.status, 404);
  const body = await cuerpo(res);
  assertEquals(body.error, "sin suscripciones activas");
  assert(typeof body.retryInSeconds === "number" && (body.retryInSeconds as number) > 0);
  assert((body.retryInSeconds as number) <= 60);

  // Lo que cierra el bucle: la reserva se queda. Sin esto, el siguiente request
  // vuelve a reservar la misma clave y a pagar la sesión, las dos llamadas a Vault y
  // las consultas de casas, contactos y suscripciones otra vez.
  assertEquals(db.callsTo("push_log", "delete").length, 0);
  assertEquals(db.callsTo("push_log", "insert").length, 1);
});

Deno.test("el bucket corta el segundo intento dentro del mismo minuto", async () => {
  const db = guionConfirmacion();
  const deps = { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 };

  const primero = await cuerpo(await handle(peticionNow(), ENV, deps));
  assertEquals(primero.ok, false);

  // Mismo bucket: la clave única de `push_log` salta y no sale ningún push. Ya no
  // se responde `ok: true` con `delivered: 0`, que se contradicen: `ok` es false,
  // el motivo viaja con `skipped` y los segundos que faltan para el siguiente
  // bucket también. Reintentar en bucle no produce un aviso nuevo, solo peticiones.
  const segundo = await handle(peticionNow(), ENV, deps);
  assertEquals(segundo.status, 200);
  const body = await cuerpo(segundo);
  assertEquals(body.ok, false);
  assertEquals(body.skipped, true);
  assertEquals(body.error, "ya se confirmo en este minuto");
  assert(typeof body.retryInSeconds === "number");
  assertEquals(body.delivered, undefined);
  // Y lo que de verdad mide el bucle: el segundo intento no vuelve a leer las
  // suscripciones ni a tocar la reserva. Choca en la clave única y ahí acaba.
  assertEquals(db.callsTo("push_subscriptions").length, 1);
  assertEquals(db.callsTo("push_log", "delete").length, 0);
});

Deno.test("pasado el bucket se puede volver a pedir la confirmación", async () => {
  // Un minuto es el enfriamiento, y tiene que ser suficiente para no estorbar al
  // uso normal: crear un cumpleaños y corregirlo no puede comerse la confirmación.
  const db = guionConfirmacion();
  let reloj = 1_800_000_000_000;
  const deps = { createDb: () => db as unknown as SupabaseClient, now: () => reloj };

  await handle(peticionNow(), ENV, deps);
  reloj += 61_000;

  const otro = await cuerpo(await handle(peticionNow(), ENV, deps));
  assertEquals(otro.ok, false);
  assertEquals(otro.error, "sin suscripciones activas");
  assertEquals(db.callsTo("push_log", "insert").length, 2);
});

Deno.test("la reserva de la confirmación va por usuario y no por referencia", async () => {
  // La clave lleva el bucket y el usuario, no el contacto: lo que hay que impedir es
  // el bucle de peticiones, no dos avisos del mismo evento.
  const db = guionConfirmacion();
  const reloj = 1_800_000_000_000;
  await handle(peticionNow(), ENV, { createDb: () => db as unknown as SupabaseClient, now: () => reloj });

  const clave = String(db.callsTo("push_log", "insert")[0].payload?.dedupe_key);
  assertEquals(clave, `now:${USER}:${Math.floor(reloj / 60_000)}`);
});

// ---------------------------------------------------------------------------
// La reserva se pide ANTES de validar nada: sin esto, un 4xx de validación es el
// bucle más barato que queda (paga sesión, Vault y la consulta, y no escribe nada).
// ---------------------------------------------------------------------------

Deno.test("una referencia que no existe también quema el bucket", async () => {
  // El caso que motivó el arreglo: antes salía un 404 sin escribir fila, así que
  // el mismo request se podía repetir indefinidamente pagando la validación de
  // sesión y las dos llamadas a Vault cada vez.
  const db = guionConfirmacion({ "contacts:select": [filas([])] });
  const deps = { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 };

  const res = await handle(peticionNow(), ENV, deps);
  assertEquals(res.status, 404);
  assertEquals((await cuerpo(res)).error, "ese contacto no existe");
  assertEquals(db.pushLogRows(), 1);
  assertEquals(db.callsTo("push_log", "delete").length, 0);

  // Y en el mismo minuto no vuelve a preguntar: choca en la clave única. La segunda
  // petición llega a hacer el `insert` —no hay forma de saber que está repetida sin
  //arlo a probar—, pero no pasa de ahí ni deja una segunda fila.
  const repetido = await handle(peticionNow(), ENV, deps);
  assertEquals((await cuerpo(repetido)).skipped, true);
  assertEquals(db.pushLogRows(), 1);
  assertEquals(db.callsTo("contacts").length, 1);
});

Deno.test("pasado el bucket, una referencia que no existe vuelve a preguntar", async () => {
  // Que la reserva caduque con el bucket es lo que la deja ser un enfriamiento y no
  // una condena: al minuto siguiente la petición se atiende con normalidad.
  const db = guionConfirmacion({ "contacts:select": [filas([])] });
  let reloj = 1_800_000_000_000;
  const deps = { createDb: () => db as unknown as SupabaseClient, now: () => reloj };

  await handle(peticionNow(), ENV, deps);
  reloj += 61_000;

  const otro = await cuerpo(await handle(peticionNow(), ENV, deps));
  assertEquals(otro.error, "ese contacto no existe");
  assertEquals(db.callsTo("push_log", "insert").length, 2);
  assertEquals(db.callsTo("contacts").length, 2);
});

Deno.test("un tipo inválido también deja fila", async () => {
  // Prueba de que la reserva va antes de validar el tipo, y no después: un 400 que
  // no escribe nada es exactamente el bucle que había que cerrar.
  const db = guionConfirmacion();
  const res = await handle(peticionNow({ type: "inventado" }), ENV, {
    createDb: () => db as unknown as SupabaseClient,
    now: () => 1_800_000_000_000,
  });

  assertEquals(res.status, 400);
  assertEquals((await cuerpo(res)).error, "tipo invalido");
  assertEquals(db.callsTo("push_log", "insert").length, 1);
  // Y ni siquiera ha llegado a mirar preferencias: la fila se puso primero.
  assertEquals(db.callsTo("push_preferences").length, 0);
});

// ---------------------------------------------------------------------------
// `mode=test`: el enfriamiento tampoco puede anularse a sí mismo.
// ---------------------------------------------------------------------------

/** Llamada de `mode=test` con sesión, que es el botón de Ajustes. */
function peticionTest(): Request {
  return new Request(`${FN}?mode=test`, { method: "POST", headers: { authorization: "Bearer sesion" } });
}

Deno.test("sin suscripciones, el aviso de prueba tampoco se puede repetir en bucle", async () => {
  // Aquí la reserva se soltaba cuando la lista salía vacía, que es el estado trivial:
  // con cero suscripciones el enfriamiento de 5 minutos no se aplicaba nunca y
  // `?mode=test` quedaba sin límite, que es justo para lo que existe.
  const db = new FakeDb({ "push_subscriptions:select": [filas([])] });
  const deps = { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 };

  const res = await handle(peticionTest(), ENV, deps);
  assertEquals((await cuerpo(res)).error, "sin suscripciones activas en este navegador");
  assertEquals(db.pushLogRows(), 1);
  assertEquals(db.callsTo("push_log", "delete").length, 0);

  // El segundo intento choca en la reserva y dice cuánto queda, en vez de repetir
  // la lectura de suscripciones y el envío.
  const repetido = await cuerpo(await handle(peticionTest(), ENV, deps));
  assertEquals(repetido.ok, false);
  assertEquals(repetido.error, "demasiado rapido");
  assert(typeof repetido.retryInSeconds === "number");
  assert((repetido.retryInSeconds as number) <= 300);
  assertEquals(db.pushLogRows(), 1);
  assertEquals(db.callsTo("push_subscriptions").length, 1);
});

Deno.test("mode=test con fallo de lectura no suelta la reserva", async () => {
  // El otro caso que hay que no mezclar con el de la lista vacía: aquí no se sabe si
  // hay suscripciones, así que el motivo es de fallo y no de "no tienes ninguna", y
  // la fila se queda igual. El 200 es el de siempre en este modo: `runTestPush` no
  // elige status, el que lleva el 500 de verdad es el camino de `mode=now`.
  const db = new FakeDb({ "push_subscriptions:select": [fallo("statement timeout")] });
  const res = await handle(peticionTest(), ENV, {
    createDb: () => db as unknown as SupabaseClient,
    now: () => 1_800_000_000_000,
  });

  assertEquals(res.status, 200);
  assertEquals((await cuerpo(res)).error, "no se pudieron leer tus suscripciones");
  assertEquals(db.callsTo("push_log", "delete").length, 0);
});

// ---------------------------------------------------------------------------
// Un fallo de la base de datos no se cuenta como "no tienes nada".
// ---------------------------------------------------------------------------

Deno.test("un fallo al leer las casas responde 500, no un 404 de 'no tienes casas'", async () => {
  const db = guionConfirmacion({ "casa_members:select": [fallo("connection reset")] });
  const res = await handle(peticionNow(), ENV, { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 });

  // El 404 afirmaba algo falso: la base de datos no respondió, no es que el usuario
  // no tenga casas. Con 500 el cliente puede reintentar.
  assertEquals(res.status, 500);
  assertEquals((await cuerpo(res)).error, "no se pudieron leer tus casas");
});

Deno.test("un fallo al leer las suscripciones responde 500 y no suelta la reserva", async () => {
  const db = guionConfirmacion({ "push_subscriptions:select": [fallo("statement timeout")] });
  const res = await handle(peticionNow(), ENV, { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 });

  // Decir "sin suscripciones activas" cuando lo que pasó es que no se pudo leer la
  // lista es un motivo falso, y soltar la reserva devuelve el bucle con ese motivo.
  assertEquals(res.status, 500);
  assertEquals((await cuerpo(res)).error, "no se pudieron leer tus suscripciones");
  assertEquals(db.callsTo("push_log", "delete").length, 0);
});

Deno.test("sin casas de verdad el motivo sigue siendo 404", async () => {
  // El otro lado del arreglo 3: el vacío legítimo no se ha convertido en error.
  const db = guionConfirmacion({ "casa_members:select": [filas([])] });
  const res = await handle(peticionNow(), ENV, { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 });

  assertEquals(res.status, 404);
  assertEquals((await cuerpo(res)).error, "no perteneces a ninguna casa");
});

// ---------------------------------------------------------------------------
// La poda de `push_log` corre siempre, no solo cuando hay algo que repartir.
// ---------------------------------------------------------------------------

Deno.test("la poda de push_log corre aunque no haya nada que repartir", async () => {
  // Fuera de la ventana de catchup no hay `dispatches`, y con la poda detrás del
  // `return` la tabla no se podaba nunca: `mode=now` escribía filas `now:*` a
  // cualquier hora y crecía sin techo.
  const db = new FakeDb({ "push_subscriptions:select": [filas([])] });
  const res = await handle(
    new Request(`${FN}?sync=1`, { method: "POST", headers: { "x-cron-secret": "secreto" } }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  assertEquals(res.status, 200);
  assertEquals((await cuerpo(res)).dispatched, 0);

  const podas = db.callsTo("push_log", "delete");
  assertEquals(podas.length, 1);
  // Poda por antigüedad, y con la ventana de 30 días de siempre.
  assert(podas[0].lt !== undefined);
  assertEquals(podas[0].lt[0], "sent_at");
  assertEquals(podas[0].lt[1], new Date(1_800_000_000_000 - 30 * 86_400_000).toISOString());
});

// ---------------------------------------------------------------------------
// La rama de citas de `mode=now`: los filtros de visibilidad.
//
// Hasta aquí los 13 tests de este fichero usaban `peticionNow()`, cuyo `type` es
// `birthday`. La mitad de citas de la confirmación no tenía ni una prueba a nivel
// de handler, y con ella sus dos filtros, que son justo la afirmación de seguridad
// del módulo: una cita solo se confirma a quien la escribió y solo si sigue siendo
// miembro de la casa. Un exmiembro conserva sus filas en `appointments` porque solo
// se le borra de `casa_members` (ver el comentario de `runNowPush`), así que sin
// `.eq("user_id", …)` y `.in("casa_id", …)` seguiría recibiendo los títulos y las
// horas de una casa a la que ya no pertenece.
//
// Estos tests no se escriben con el doble viejo: `.in()` era un no-op, así que el filtro
// aplicado, el equivocado y el ausente daba el mismo resultado y el test pasaba igual.
// Con `.in()` aplicando de verdad, quitar cualquiera de los dos en el handler sale rojo.
// ---------------------------------------------------------------------------

Deno.test("la cita se confirma con el filtro de autor y de casa puesto", async () => {
  const db = guionCita();
  const res = await handle(
    peticionNow({ type: "appointment", id: CITA }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  // Lo que sale por la consulta, no solo lo que responde: que la casa y el autor
  // van en el filtro y no se leyeran sin comprobar.
  const consulta = db.callsTo("appointments", "select");
  assertEquals(consulta.length, 1);
  assertEquals(consulta[0].eq.id, CITA);
  assertEquals(consulta[0].eq.user_id, USER);
  assertEquals(consulta[0].inList.casa_id, [CASA]);

  // Y con eso la cita llega al envío: sin suscripciones, el 404 es el de "no hay a
  // quién avisar", que es un camino distinto del 404 de "no la veo".
  assertEquals(res.status, 404);
  assertEquals((await cuerpo(res)).error, "sin suscripciones activas");
});

Deno.test("una cita de otra casa no se confirma, aunque el usuario sea miembro de ella", async () => {
  // El caso del exmiembro. La fila existe y es exactamente igual salvo el `casa_id`.
  // Sin el `.in("casa_id", …)` el filtro no la pararía y el título y la hora saldrían.
  const db = guionCita({
    "appointments:select": [filas([citaDe(USER, "55555555-5555-4555-8555-555555555555", "both")])],
  });
  const res = await handle(
    peticionNow({ type: "appointment", id: CITA }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  assertEquals(res.status, 404);
  assertEquals((await cuerpo(res)).error, "esa cita no existe");
  // Ni una sola lectura de suscripciones: no se llegó a intentar avisar a nadie.
  assertEquals(db.callsTo("push_subscriptions").length, 0);
});

Deno.test("la cita de otro usuario no se confirma, aunque sea de su casa", async () => {
  // El otro filtro: dos miembros de la misma casa se ven las citas el uno del otro
  // en la app, pero la confirmación es de quien la acaba de crear. Sin
  // `.eq("user_id", …)`, cualquier miembro recibiría el aviso de la cita del otro.
  const db = guionCita({
    "appointments:select": [
      filas([citaDe("66666666-6666-4666-8666-666666666666", CASA, "both")]),
    ],
  });
  const res = await handle(
    peticionNow({ type: "appointment", id: CITA }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  assertEquals(res.status, 404);
  assertEquals((await cuerpo(res)).error, "esa cita no existe");
  assertEquals(db.callsTo("push_subscriptions").length, 0);
});

Deno.test("un reminder_choice que no es de la lista se traduce a 'sin aviso'", async () => {
  // La columna no tiene CHECK, así que un valor raro llega a la base por lo que sea.
  // `isValidChoice` lo filtra, pero lo que importa es que el filtro llegue al
  // dispatch: sin él, un valor basura se colaría como choice y se confirmaría un
  // recordatorio que el cron no mandará nunca.
  for (const basura of ["BOTH", "", null, 3]) {
    const db = guionCita({
      "appointments:select": [filas([citaDe(USER, CASA, basura)])],
    });
    const res = await handle(
      peticionNow({ type: "appointment", id: CITA }),
      ENV,
      { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
    );

    assertEquals(res.status, 404);
    // El 404 de "no hay recordatorio", no el de "no hay a quién avisar": la cita se
    // ve, lo que no hay es nada que confirmar.
    assertEquals((await cuerpo(res)).error, "no hay recordatorio que confirmar");
    assertEquals(db.callsTo("push_subscriptions").length, 0);
  }
});

Deno.test("un reminder_choice válido llega al dispatch y se confirma", async () => {
  // El control positivo del anterior: si este no llegara al envío, el test del valor
  // basura pasaría por un motivo equivocado.
  for (const choice of ["day-before", "same-day", "both"]) {
    const db = guionCita({ "appointments:select": [filas([citaDe(USER, CASA, choice)])] });
    const res = await handle(
      peticionNow({ type: "appointment", id: CITA }),
      ENV,
      { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
    );

    assertEquals(res.status, 404);
    assertEquals((await cuerpo(res)).error, "sin suscripciones activas");
  }
});

Deno.test("una cita que no existe responde 404 y no intenta enviarla", async () => {
  const db = guionCita({ "appointments:select": [filas([])] });
  const res = await handle(
    peticionNow({ type: "appointment", id: CITA }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  assertEquals(res.status, 404);
  assertEquals((await cuerpo(res)).error, "esa cita no existe");
  assertEquals(db.callsTo("push_subscriptions").length, 0);
});

Deno.test("si no se puede leer la cita responde 500, no un 404 de 'no existe'", async () => {
  // Un fallo de base de datos y una cita que no existen se parecen, y confundirlos
  // haría creer al cliente que su cita se borró.
  const db = guionCita({ "appointments:select": [fallo("statement timeout")] });
  const res = await handle(
    peticionNow({ type: "appointment", id: CITA }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  assertEquals(res.status, 500);
  assertEquals((await cuerpo(res)).error, "no se pudo leer la cita");
  assertEquals(db.callsTo("push_subscriptions").length, 0);
});

Deno.test("una cita que no se ve quema la reserva igual que una que sí", async () => {
  // El diseño de la reserva es que se pide antes de validar nada, y eso incluye antes
  // de leer la cita: si una cita ajena no quemara el bucket, `?mode=now&type=
  // appointment&id=<uuid de otra casa>` sería un bucle gratis para quien lo probara.
  const db = guionCita({
    "appointments:select": [filas([citaDe(USER, "55555555-5555-4555-8555-555555555555", "both")])],
  });
  await handle(
    peticionNow({ type: "appointment", id: CITA }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000 },
  );

  assertEquals(db.pushLogRows(), 1);
  assertEquals(db.callsTo("push_log", "delete").length, 0);
});

// ---------------------------------------------------------------------------
// Regresión: las claves VAPID se configuran antes de enviar, y quién cuda
// un fallo es lo que evita que una suscripción válida se apague sola.
//
// Estos tests son de COMPORTAMIENTO, sobre un doble de `web-push` inyectado por
// `HandlerDeps`. La versión anterior los hacía leyendo el fuente, y era frágil
// por construcción: la primera vez que se escribió, comentar la llamada a
// `setVapidDetails` dejaba el texto buscado dentro del comentario y la suite
// seguía en verde con el bug entero de vuelta. Un guard que no falla cuando
// reproduces el fallo no guarda nada, y además un comentario no es una prueba.
// Con el doble, el orden se lee en la secuencia de llamadas: si alguien mueve
// la configuración después del envío, el test se pone rojo solo.
// ---------------------------------------------------------------------------

/** Un `web-push` que registra el orden de las llamadas y puede fallar lo que se le pida. */
class FakePush {
  /** Secuencia de llamadas, en el orden en que hicieron. */
  readonly llamadas: string[] = [];
  /** Claves con las que se configuró el remitente, para comprobar que son las de Vault. */
  configured?: { subject: string; publicKey: string; privateKey: string };

  constructor(private readonly fallo?: unknown) {}

  setVapidDetails(subject: string, publicKey: string, privateKey: string): void {
    this.configured = { subject, publicKey, privateKey };
    this.llamadas.push("setVapidDetails");
  }

  // Sin `async`: no hay nada que awaits, y `deno lint` lo señala. La firma pide
  // promesa, y eso es lo que devuelve.
  sendNotification(): Promise<unknown> {
    this.llamadas.push("sendNotification");
    if (this.fallo !== undefined) return Promise.reject(this.fallo);
    return Promise.resolve({});
  }
}

/** Un `web-push` normal para los tests que no miran el push. */
function pushSinInteres(): FakePush {
  return new FakePush();
}

/** Índice de la primera aparición de `evento`, o -1. */
function cuando(llamadas: string[], evento: string): number {
  return llamadas.indexOf(evento);
}

/** Una suscripción viva tal y como la lee el reparto. */
function suscripcion(id: string, failureCount = 0): Record<string, unknown> {
  return {
    id,
    user_id: USER,
    endpoint: `https://push.example/${id}`,
    p256dh: "clave-publica",
    auth: "clave-privada",
    timezone: MADRID,
    failure_count: failureCount,
    active: true,
  };
}

/**
 * Guion del camino del cron: un `POST` sin sesión, con el secreto, que llega al
 * reparto. Se llama `?sync=1` para que la respuesta contenga el resultado y el
 * test no dependa del trabajo en segundo plano.
 */
function peticionCron(params: Record<string, string> = {}): Request {
  const url = new URL(`${FN}?sync=1`);
  for (const [clave, valor] of Object.entries(params)) url.searchParams.set(clave, valor);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": "secreto" },
  });
}

/**
 * Guion del reparto con una cita de HOY a las 09:00 locales y una suscripción
 * viva, que es la situación mínima para que salga un aviso de verdad.
 */
function guionReparto(extra: Guion = {}): FakeDb {
  return new FakeDb({
    // 2026-03-16T08:05Z son las 09:05 en Madrid: dentro de la ventana de catchup.
    "push_subscriptions:select": [
      filas([suscripcion("sub-1")]),
      filas([suscripcion("sub-1")]),
    ],
    // Cada grupo (una zona) lee sus propias preferencias, sus casas y sus citas,
    // así que cada guion necesita dos respuestas encadenadas: `answer()` hace
    // `shift()` mientras quede más de una.
    "push_preferences:select": [
      filas([{ user_id: USER, enabled: true, birthday_choice: "none" }]),
      filas([{ user_id: USER, enabled: true, birthday_choice: "none" }]),
    ],
    "casa_members:select": [
      filas([{ user_id: USER, casa_id: CASA }]),
      filas([{ user_id: USER, casa_id: CASA }]),
    ],
    "appointments:select": [
      filas([{ id: CITA, user_id: USER, casa_id: CASA, title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "same-day" }]),
      filas([{ id: CITA, user_id: USER, casa_id: CASA, title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "same-day" }]),
    ],
    ...extra,
  });
}

const AHORA_EN_LA_VENTANA = Date.parse("2026-03-16T08:05:00Z");

Deno.test("el reparto configura VAPID con las claves de Vault antes de enviar", async () => {
  const push = pushSinInteres();
  await handle(peticionCron(), ENV, {
    createDb: () => guionReparto() as unknown as SupabaseClient,
    now: () => AHORA_EN_LA_VENTANA,
    push,
  });

  const configurar = cuando(push.llamadas, "setVapidDetails");
  const enviar = cuando(push.llamadas, "sendNotification");
  assert(configurar !== -1, "el reparto no configuró VAPID: enviaría sin remitente");
  assert(enviar !== -1, "no se envió nada: el test está mirando un camino que no llega al envío");
  assert(
    configurar < enviar,
    `VAPID se configura DESPUÉS de enviar (${push.llamadas.join(" -> ")})`,
  );
  // Y con las claves de verdad, no con una constante: si alguien mueve el
  // `configureWebPush` a otro módulo, esto sigue atando que lee las suyas.
  assertEquals(push.configured?.publicKey, VAPID_PUBLIC);
  assertEquals(push.configured?.privateKey, VAPID_PRIVATE);
});

Deno.test("el aviso de prueba también configura VAPID antes de enviar", async () => {
  // El otro camino. Si este se rompe, el botón "Enviar" de Ajustes deja de avisar,
  // que es el síntoma que hace sospechar de la suscripción cuando lo que falla es esto.
  const push = pushSinInteres();
  const db = new FakeDb({
    "push_subscriptions:select": [filas([suscripcion("sub-1")])],
  });
  const res = await handle(
    new Request(`${FN}?mode=test`, { method: "POST", headers: { authorization: "Bearer sesion" } }),
    ENV,
    { createDb: () => db as unknown as SupabaseClient, now: () => 1_800_000_000_000, push },
  );

  assertEquals((await cuerpo(res)).ok, true);
  assert(configurarAntes(push.llamadas), `orden incorrecto: ${push.llamadas.join(" -> ")}`);
});

/** ¿Se configuró VAPID antes del primer envío? */
function configurarAntes(llamadas: string[]): boolean {
  const configurar = cuando(llamadas, "setVapidDetails");
  const enviar = cuando(llamadas, "sendNotification");
  return configurar !== -1 && enviar !== -1 && configurar < enviar;
}

/** Un error con `statusCode`, como los que lanza `web-push`. */
function errorConEstado(status: number): Error {
  return Object.assign(new Error(`push service ${status}`), { statusCode: status });
}

Deno.test("un 403 del push service no desactiva la suscripción, pero sí reintenta", async () => {
  // El fallo que costó los recordatorios de este repo, por la vía que quedaba:
  // un rechazo de configuración se contaba como fallo de la suscripción, y a los
  // cinco la apagaba. `active = false` es irreversible, así que contar infra
  // contra el contador de suscripción apagaba a gente que no tenía nada malo.
  const push = new FakePush(errorConEstado(403));
  const db = guionReparto();
  const res = await handle(peticionCron(), ENV, {
    createDb: () => db as unknown as SupabaseClient,
    now: () => AHORA_EN_LA_VENTANA,
    push,
  });

  const cuerpoRes = await cuerpo(res);
  assertEquals(cuerpoRes.sent, 0);

  // Ni una escritura que toque `failure_count` o `active`.
  const escrituras = db.callsTo("push_subscriptions", "update");
  for (const call of escrituras) {
    assertEquals(call.payload?.failure_count, undefined, `contó un 403 como fallo: ${JSON.stringify(call.payload)}`);
    assertEquals(call.payload?.active, undefined, `desactivó por un 403: ${JSON.stringify(call.payload)}`);
  }

  // La reserva sí se libera, y a propósito: un 429 —transitorio, y justo al
  // lado— ya lo hacía, así que tratar el 403 de otra forma era incoherente y
  // costaba el recordatorio de ese día para siempre. Liberándola, el aviso sale
  // en cuanto la configuración se arregle y dentro de la ventana de catchup.
  //
  // Se cuentan solo los `delete` que llevan el filtro de la reserva. El reparto
  // empieza podando `push_log` por antigüedad, y ese `delete` sale siempre: si
  // se contara, el test pasaría por un borrado que no es el que importa.
  assertEquals(
    reservasSueltas(db).length,
    1,
    "un 403 no liberó la reserva: el recordatorio de ese día se pierde para siempre",
  );
});

/**
 * Los `delete` de `push_log` que sueltan una reserva concreta, sin contar la poda
 * de antigüedad que hace el reparto al empezar.
 */
function reservasSueltas(db: FakeDb): Call[] {
  return db.callsTo("push_log", "delete").filter((call) => call.eq.dedupe_key !== undefined);
}

Deno.test("un 429 sí cuenta como fallo de la suscripción", async () => {
  // El otro lado de la línea: un 429 es transitorio y sí es de la suscripción.
  // Si esto no contara, un rate limit del servicio de push sería invisible y la
  // suscripción nunca se protegería de un endpoint realmente malo.
  const push = new FakePush(errorConEstado(429));
  const db = guionReparto();
  await handle(peticionCron(), ENV, {
    createDb: () => db as unknown as SupabaseClient,
    now: () => AHORA_EN_LA_VENTANA,
    push,
  });

  const conContador = db
    .callsTo("push_subscriptions", "update")
    .filter((call) => call.payload?.failure_count !== undefined);
  assertEquals(conContador.length, 1, "un 429 no llegó a contarse como fallo");
  assertEquals(conContador[0].payload?.failure_count, 1);
  assertEquals(conContador[0].payload?.active, true);

  // Y al revés que el 403: aquí sí se suelta la reserva, porque un 429 sí
  // tiene arreglo esperando dentro de la ventana de catchup.
  assertEquals(
    reservasSueltas(db).length,
    1,
    "un 429 no debería soltar la reserva: se podría reintentar dentro de la ventana",
  );
});

Deno.test("una suscripción que entrega y luego falla no queda con el contador viejo", async () => {
  // El contador se resucitaba con el valor leído al principio de la ejecución: si
  // un aviso entregaba (y ponía el contador a 0) y otro fallaba después en la
  // MISMA ejecución, se reescribía `viejo + 1` encima de ese 0. Con el viejo en
  // 4, una suscripción que acababa de entregar acababa en 5 y se apagaba.
  //
  // El doble solo devuelve una suscripción por lectura, así que para tener dos
  // despatch en el mismo lote hacen falta dos citas y dos respuestas en cola.
  const push = new FakePush();
  let envio = 0;
  const pushConUnFallo = {
    setVapidDetails: (s: string, p: string, pr: string) => push.setVapidDetails(s, p, pr),
    sendNotification: () => {
      envio++;
      push.llamadas.push("sendNotification");
      // El primero entra bien, el segundo revienta con un 429.
      return envio === 2 ? Promise.reject(errorConEstado(429)) : Promise.resolve({});
    },
  };

  const db = guionReparto({
    "push_subscriptions:select": [
      filas([suscripcion("sub-1", 4)]),
      filas([suscripcion("sub-1", 4)]),
    ],
    "appointments:select": [
      filas([
        { id: CITA, user_id: USER, casa_id: CASA, title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "same-day" },
        { id: "55555555-5555-4555-8555-555555555555", user_id: USER, casa_id: CASA, title: "Gym", starts_at: "2026-03-16T18:00:00Z", reminder_choice: "same-day" },
      ]),
    ],
  });

  await handle(peticionCron(), ENV, {
    createDb: () => db as unknown as SupabaseClient,
    now: () => AHORA_EN_LA_VENTANA,
    push: pushConUnFallo,
  });

  // Una entrega y un fallo en el mismo lote: el estado final consolidado tiene
  // que reflejar el fallo, pero calculado desde el 0 que dejó la entrega, no
  // desde el 4 con el que se leyó la fila.
  const finales = db
    .callsTo("push_subscriptions", "update")
    .filter((call) => call.payload?.failure_count !== undefined);
  assert(finales.length >= 1, "no se escribió el contador de fallos");
  const ultimo = finales[finales.length - 1];
  assertEquals(
    ultimo.payload?.active,
    true,
    `una suscripción que entregó quedó apagada: ${JSON.stringify(ultimo.payload)}`,
  );
  assert(
    (ultimo.payload?.failure_count as number) < 5,
    `el contador se resucitó con el valor viejo: ${JSON.stringify(ultimo.payload)}`,
  );
});

Deno.test("una excepción que se escapa responde 500 CON cabeceras CORS, no un 500 pelado", async () => {
  // `Deno.serve` en `index.ts` no tiene catch, así que antes de esta red una
  // excepción sin cubrir salía como un 500 sin cabeceras: el navegador no podía ni
  // leer por qué había fallado. El caso real que la motivó es `setVapidDetails`,
  // que lanza `TypeError` si las claves de Vault están mal formadas.
  //
  // El doble de push es el que revienta, y lo hace al configurar VAPID, que es lo
  // primero que hace cualquier camino de envío.
  class PushQueRevienta {
    setVapidDetails(): void {
      throw new TypeError("The VAPID public key is not valid");
    }
    sendNotification(): Promise<unknown> {
      return Promise.resolve({});
    }
  }

  const res = await handle(
    new Request(`${FN}?mode=test`, {
      method: "POST",
      headers: { authorization: "Bearer sesion", origin: "https://micasa-demo.vercel.app" },
    }),
    ENV,
    {
      createDb: () => new FakeDb({ "push_subscriptions:select": [filas([suscripcion("sub-1")])] }) as unknown as SupabaseClient,
      now: () => 1_800_000_000_000,
      push: new PushQueRevienta(),
    },
  );

  assertEquals(res.status, 500);
  // Lo que de verdad importa: el origen permitido puede leer el motivo.
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "https://micasa-demo.vercel.app",
    "el 500 salió sin cabeceras CORS: el navegador no puede leer por qué falló",
  );
  assertEquals(await cuerpo(res), { error: "error interno" });
});

Deno.test("la red de seguridad no filtra el error interno al navegador", async () => {
  // El cuerpo del 500 es genérico a propósito. El motivo va al log, que es donde
  // lo lee quien puede arreglarlo; mandarlo también al navegador publicaría la
  // forma de la configuración por error.
  class PushQueFalla {
    setVapidDetails(): void {
      throw new Error("la clave privada de Vault es sk_live_SECRETA");
    }
    sendNotification(): Promise<unknown> {
      return Promise.resolve({});
    }
  }

  const res = await handle(
    new Request(`${FN}?mode=test`, {
      method: "POST",
      headers: { authorization: "Bearer sesion", origin: "https://micasa-demo.vercel.app" },
    }),
    ENV,
    {
      createDb: () => new FakeDb({ "push_subscriptions:select": [filas([suscripcion("sub-1")])] }) as unknown as SupabaseClient,
      now: () => 1_800_000_000_000,
      push: new PushQueFalla(),
    },
  );

  const texto = await res.text();
  assert(!texto.includes("sk_live_SECRETA"), `el 500 filtra el motivo interno: ${texto}`);
  assert(!texto.includes("Vault"), `el 500 nombra el origen del fallo: ${texto}`);
});

Deno.test("con dos avisos y un 401, ambos liberan su reserva y solo el 429 cuenta", async () => {
  // Cuando la reserva se conservaba en fallo de infraestructura, este caso
  // destapó que el flag era estado del LOTE leído dentro del bucle: el aviso con
  // 401 lo dejaba en `true` y el siguiente, que podía haber fallado por un 429 de
  // lo más reintentable, lo leía y perdía su reintento para siempre.
  //
  // El flag por aviso ya no existe —liberar la reserva es ahora la regla única—,
  // pero el caso se queda porque ata dos cosas que sí pueden volver a romperse:
  // que los dos reintenten, y que solo uno cuente como fallo de suscripción.
  let envio = 0;
  const push = {
    setVapidDetails: (s: string, p: string, pr: string) => pushSinInteres().setVapidDetails(s, p, pr),
    sendNotification: () => {
      envio++;
      // El primer aviso recibe un 401 (configuración) y el segundo un 429 (rate).
      return envio === 1 ? Promise.reject(errorConEstado(401)) : Promise.reject(errorConEstado(429));
    },
  };

  const dosAvisos = [
    { id: CITA, user_id: USER, casa_id: CASA, title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "same-day" },
    { id: "55555555-5555-4555-8555-555555555555", user_id: USER, casa_id: CASA, title: "Gym", starts_at: "2026-03-16T18:00:00Z", reminder_choice: "same-day" },
  ];

  const db = guionReparto({
    "push_subscriptions:select": [filas([suscripcion("sub-1")]), filas([suscripcion("sub-1")])],
    "appointments:select": [filas(dosAvisos)],
  });

  await handle(peticionCron(), ENV, {
    createDb: () => db as unknown as SupabaseClient,
    now: () => AHORA_EN_LA_VENTANA,
    push,
  });

  // Los dos liberan: ninguno se queda sin reintento por el fallo del otro.
  const sueltas = reservasSueltas(db);
  assertEquals(sueltas.length, 2, `los dos avisos deberían liberar su reserva; soltaron ${sueltas.length}`);

  // Y solo el 429 cuenta: el 401 no toca el contador.
  const conContador = db
    .callsTo("push_subscriptions", "update")
    .filter((call) => call.payload?.failure_count !== undefined);
  assertEquals(conContador.length, 1, "el 401 se contó como fallo de suscripción");
  assertEquals(conContador[0].payload?.failure_count, 1);
});

Deno.test("una suscripción inservible se borra en los DOS caminos de envío", async () => {
  // Atar el cableado del clasificador, en comportamiento y no leyendo el fuente.
  //
  // La versión anterior de esta comprobación contaba apariciones de
  // `isUnusableSubscription(error)` en el fuente de `handler.ts`, con un regex y
  // `--allow-read` en el comando de test. Se quitó porque su premisa ya era
  // falsa: decía que probar el cableado "exigiría inyectar `web-push`", y eso es
  // justo lo que hace `HandlerDeps.push`. Y porque un test que cuenta
  // apariciones en el fuente tiene el defecto que ya mordió dos veces en este
  // bloque: comentar la llamada deja el texto dentro del comentario y la suite
  // sigue en verde con el bug de vuelta.
  //
  // Lo que se ata ahora es el efecto: una suscripción con claves imposibles se
  // borra, y lo hace por los dos caminos. Si alguien quita el clasificador de
  // cualquiera de los dos, la fila deja de borrarse y esto se pone rojo.
  const pushInservible = () =>
    new FakePush(new Error("The subscription p256dh value should be 65 bytes long."));

  // Camino 1: el aviso de prueba de Ajustes.
  const dbTest = new FakeDb({
    "push_subscriptions:select": [filas([suscripcion("sub-inservible")])],
  });
  const resTest = await handle(
    new Request(`${FN}?mode=test`, { method: "POST", headers: { authorization: "Bearer sesion" } }),
    ENV,
    {
      createDb: () => dbTest as unknown as SupabaseClient,
      now: () => 1_800_000_000_000,
      push: pushInservible(),
    },
  );
  // El cuerpo no se mira a propósito: con `delivered === 0` el aviso de prueba
  // responde por otra rama. Lo que importa es que la fila se borra, y eso se ve
  // en la llamada de `delete`.
  await cuerpo(resTest);
  assertEquals(
    dbTest.callsTo("push_subscriptions", "delete").length,
    1,
    "el aviso de prueba no borró la suscripción inservible",
  );

  // Camino 2: el reparto del cron, que es el que se llevaba los avisos.
  const dbReparto = guionReparto({
    "push_subscriptions:select": [
      filas([suscripcion("sub-inservible")]),
      filas([suscripcion("sub-inservible")]),
    ],
  });
  const resReparto = await handle(peticionCron(), ENV, {
    createDb: () => dbReparto as unknown as SupabaseClient,
    now: () => AHORA_EN_LA_VENTANA,
    push: pushInservible(),
  });
  assertEquals((await cuerpo(resReparto)).removedSubscriptions, 1);
  assertEquals(
    dbReparto.callsTo("push_subscriptions", "delete").length,
    1,
    "el reparto no borró la suscripción inservible",
  );
});

Deno.test("discriminación por lote: un 401 aislado = fallo de suscripción, múltiples 401 = infraestructura", async () => {
  // Caso 1: UNA suscripción con 401 → fallo de suscripción (no infra)
  // La respuesta NO debe decir "configuración rota" sino "sin suscripciones activas"
  // porque desde la perspectiva del usuario su única suscripción falló.
  const conInfra = () => new FakePush(errorConEstado(401));

  const dbTest = new FakeDb({ "push_subscriptions:select": [filas([suscripcion("sub-1")])] });
  const resTest = await handle(
    new Request(`${FN}?mode=test`, { method: "POST", headers: { authorization: "Bearer sesion" } }),
    ENV,
    { createDb: () => dbTest as unknown as SupabaseClient, now: () => 1_800_000_000_000, push: conInfra() },
  );
  const cuerpoTest = await cuerpo(resTest);
  assertEquals(cuerpoTest.ok, false);
  assert(
    String(cuerpoTest.error).includes("suscripciones"),
    `un 401 aislado debe reportarse como fallo de suscripción: ${JSON.stringify(cuerpoTest)}`,
  );

  // Caso 2: DOS suscripciones con 401 → infraestructura (configuración rota)
  // La respuesta debe decir "configuración rota", no "sin suscripciones"
  const dbTest2 = new FakeDb({ "push_subscriptions:select": [filas([suscripcion("sub-1"), suscripcion("sub-2")])] });
  const resTest2 = await handle(
    new Request(`${FN}?mode=test`, { method: "POST", headers: { authorization: "Bearer sesion" } }),
    ENV,
    { createDb: () => dbTest2 as unknown as SupabaseClient, now: () => 1_800_000_000_000, push: conInfra() },
  );
  const cuerpoTest2 = await cuerpo(resTest2);
  assertEquals(cuerpoTest2.ok, false);
  assert(
    !String(cuerpoTest2.error).includes("suscripciones"),
    `dos 401 deben reportarse como infraestructura: ${JSON.stringify(cuerpoTest2)}`,
  );

  // Y el camino de la confirmación (now): una suscripción con 401 → fallo de suscripción
  // La respuesta NO debe ser 502 "configuración rota" sino 404/400 "sin suscripciones"
  const dbNow = guionConfirmacion({ "push_subscriptions:select": [filas([suscripcion("sub-1")])] });
  const resNow = await handle(peticionNow(), ENV, {
    createDb: () => dbNow as unknown as SupabaseClient,
    now: () => 1_800_000_000_000,
    push: conInfra(),
  });
  assertEquals(resNow.status, 404);
  const cuerpoNow = await cuerpo(resNow);
  assert(
    String(cuerpoNow.error).includes("suscripciones"),
    `un 401 aislado en now debe ser fallo de suscripción: ${JSON.stringify(cuerpoNow)}`,
  );

  // Dos suscripciones en now con 401 → infra (502)
  const dbNow2 = guionConfirmacion({ "push_subscriptions:select": [filas([suscripcion("sub-1"), suscripcion("sub-2")])] });
  const resNow2 = await handle(peticionNow(), ENV, {
    createDb: () => dbNow2 as unknown as SupabaseClient,
    now: () => 1_800_000_000_000,
    push: conInfra(),
  });
  assertEquals(resNow2.status, 502);
  const cuerpoNow2 = await cuerpo(resNow2);
  assert(
    !String(cuerpoNow2.error).includes("suscripciones"),
    `dos 401 en now deben reportarse como infraestructura: ${JSON.stringify(cuerpoNow2)}`,
  );
});