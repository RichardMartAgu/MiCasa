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
import { assert, assertEquals } from "jsr:@std/assert@1";

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { handle } from "./handler.ts";

const FN = "https://proyecto.supabase.co/functions/v1/send-web-push";
const USER = "11111111-1111-4111-8111-111111111111";
const CASA = "22222222-2222-4222-8222-222222222222";
const CONTACTO = "33333333-3333-4333-8333-333333333333";
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

  in(_columna: string, _valores: unknown[]): Query {
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
    const call: Call = { table, op: "select", eq: {} };
    this.calls.push(call);
    return new Query(call, this);
  }

  async rpc(nombre: string): Promise<Answer> {
    // Los tests pasan el secreto y las claves por `env`, así que ninguna lectura de
    // Vault debería ocurrir. Si ocurre, se ve aquí en vez de colgarse en la red.
    return fallo(`el test no debería leer Vault, pero pidió ${nombre}`);
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
    // `maybeSingle` de verdad devuelve la fila, no la lista con la fila dentro. Sin
    // esto, `preferences.birthday_choice` sería `undefined` sobre un array y la
    // función leería "sin aviso de cumpleaños" en un caso que sí lo tiene.
    if (call.single && Array.isArray(answer.data)) {
      return { ...answer, data: answer.data[0] ?? null };
    }
    return answer;
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
    "push_preferences:select": [filas([{ enabled: true, birthday_choice: "both" }])],
    "casa_members:select": [filas([{ casa_id: CASA }])],
    "contacts:select": [filas([{ id: CONTACTO, name: "Lucía", birth_date: "1990-06-20" }])],
    "push_subscriptions:select": [filas([])],
    ...extra,
  });
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
  // El caso que motivated el arreglo: antes salía un 404 sin escribir fila, así que
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
