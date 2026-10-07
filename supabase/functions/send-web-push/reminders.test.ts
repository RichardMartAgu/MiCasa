import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  addDays,
  appointmentQueryUpperBound,
  birthdayChoiceFor,
  buildAppointmentDispatches,
  buildBirthdayDispatches,
  buildNowAppointmentDispatch,
  buildNowBirthdayDispatch,
  dedupeKey,
  fallsOnLocalDay,
  formatTime,
  formatMonthDay,
  candidatesFor,
  isPushEnabled,
  isValidChoice,
  isValidTimeZone,
  localDayUtc,
  nextBirthdayDay,
  nowDedupeKey,
  sanitizeText,
  nineAmUtc,
  truncate,
  type Context,
} from "./reminders.ts";

/** Usuario y bucket de ejemplo para la clave de idempotencia de `mode=now`. */
const USUARIO = "11111111-1111-4111-8111-111111111111";
const BUCKET = 29_000_000;

const MADRID = "Europe/Madrid";
const MEXICO = "America/Mexico_City";
const TOKYO = "Asia/Tokyo";
const LONDON = "Europe/London";

function ctx(nowIso: string, timeZone: string, catchupMinutes = 180): Context {
  const now = new Date(nowIso);
  return {
    now,
    timeZone,
    window: { from: new Date(now.getTime() - catchupMinutes * 60_000), to: now },
  };
}

Deno.test("localDayUtc NO lanza con una zona inválida: devuelve cadena vacía", () => {
  // Esta función se llama desde el reparto y no puede lanzar. `Intl` lanza
  // `RangeError` con cualquier cadena que no sea una zona real, y el valor viene
  // de `push_subscriptions.timezone`, que solo tiene un `check` de 64 caracteres.
  // Cuando sí lanzaba, una fila con `timezone = 'No/Existe'` tumbaba el lote entero
  // y nadie recibía ese ciclo, ni siquiera las personas ajenas a esa fila.
  for (const zona of ["No/Existe", "", "Europe/Madrid ", "GMT+25", "a".repeat(64)]) {
    assertEquals(
      localDayUtc(new Date("2026-03-16T08:05:00Z"), zona),
      "",
      `una zona inválida dio fecha en lugar de cadena vacía: ${JSON.stringify(zona)}`,
    );
  }
  // Y una zona buena sigue funcionando, que es lo que hace que esto no sea "no
  // hagas nada nunca".
  assertEquals(localDayUtc(new Date("2026-03-16T08:05:00Z"), "Europe/Madrid"), "2026-03-16");
});

Deno.test("localDayUtc devuelve la fecha local, no la UTC", () => {
  // 2026-03-15T23:30Z en Madrid (UTC+1 en invierno) ya es el 16.
  assertEquals(localDayUtc(new Date("2026-03-15T23:30:00Z"), MADRID), "2026-03-16");
  // En UTC+9 (Tokyo) son las 08:30 del día 16.
  assertEquals(localDayUtc(new Date("2026-03-15T23:30:00Z"), TOKYO), "2026-03-16");
  // En UTC-6 (Ciudad de México) son las 17:30 del día 15.
  assertEquals(localDayUtc(new Date("2026-03-15T23:30:00Z"), MEXICO), "2026-03-15");
});

Deno.test("nineAmUtc calcula las 09:00 locales en cada zona", () => {
  assertEquals(nineAmUtc("2026-03-16", MADRID)?.toISOString(), "2026-03-16T08:00:00.000Z");
  assertEquals(nineAmUtc("2026-03-16", TOKYO)?.toISOString(), "2026-03-16T00:00:00.000Z");
  assertEquals(nineAmUtc("2026-03-16", MEXICO)?.toISOString(), "2026-03-16T15:00:00.000Z");
  // Reino Unido en horario de verano (UTC+1) el 16 de marzo ya no cambia:
  assertEquals(nineAmUtc("2026-06-16", LONDON)?.toISOString(), "2026-06-16T08:00:00.000Z");
});

Deno.test("nineAmUtc devuelve null con una zona inválida", () => {
  assertEquals(nineAmUtc("2026-03-16", "No/Existe"), null);
});

Deno.test("addDays es TOTAL: con fecha inválida devuelve cadena vacía, no revienta", () => {
  // `addDays` no puede lanzar. Su `day` puede llegar vacío desde `localDayUtc`, que
  // devuelve `""` con una zona inválida, y `new Date("T00:00:00Z")` —sin componente
  // de fecha— da `Invalid Date` cuya `toISOString()` lanza `RangeError`. Ese error
  // salía dentro de `buildDispatches` y tumbaba el lote entero, así que una fila
  // con la zona rota impedía los avisos de todas las demás casas.
  for (const dia of ["", "no-es-fecha", "2026-13-45", "T00:00:00Z", "2026-3-1"]) {
    assertEquals(addDays(dia, 1), "", `addDays reventó o inventó fecha para ${JSON.stringify(dia)}`);
    assertEquals(addDays(dia, -1), "", `addDays reventó o inventó fecha para ${JSON.stringify(dia)}`);
  }
  // Y una fecha buena sigue funcionando, que es lo que evita que esto sea "no hagas
  // nada nunca".
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("candidatesFor sin día local NO genera candidatos", () => {
  // Sin día local no hay candidatos: `nineAmUtc` y `fallsOnLocalDay` tratan el día
  // como fecha y fallan con `""`. El corte está aquí y no en quien llama porque los
  // dos llamadores —citas y cumpleaños— tienen el mismo problema, y el segundo es
  // fácil de olvidar.
  assertEquals(candidatesFor("", "same-day"), []);
  assertEquals(candidatesFor("", "day-before"), []);
  assertEquals(candidatesFor("", "both"), []);
  // Con día válido sigue generando, con el corte de `addDays` incluido.
  assertEquals(candidatesFor("2026-03-16", "both").length, 2);
});

Deno.test("addDays cruza meses y años", () => {
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
  assertEquals(addDays("2026-01-01", -1), "2025-12-31");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
});

Deno.test("candidatesFor: el aviso de mañana es para el evento de mañana", () => {
  assertEquals(candidatesFor("2026-03-16", "none"), []);
  assertEquals(candidatesFor("2026-03-16", "day-before"), [
    { eventDay: "2026-03-17", slot: "day-before", fireDay: "2026-03-16" },
  ]);
  assertEquals(candidatesFor("2026-03-16", "same-day"), [
    { eventDay: "2026-03-16", slot: "same-day", fireDay: "2026-03-16" },
  ]);
  assertEquals(candidatesFor("2026-03-16", "both"), [
    { eventDay: "2026-03-17", slot: "day-before", fireDay: "2026-03-16" },
    { eventDay: "2026-03-16", slot: "same-day", fireDay: "2026-03-16" },
  ]);
});

Deno.test("fallsOnLocalDay compara por fecha local", () => {
  // 2026-03-16T08:00Z es el 16 en Madrid (09:00) y en Tokio (17:00).
  assertEquals(fallsOnLocalDay("2026-03-16T08:00:00Z", "2026-03-16", MADRID), true);
  assertEquals(fallsOnLocalDay("2026-03-16T08:00:00Z", "2026-03-16", TOKYO), true);
  // 2026-03-16T20:00Z: en Madrid es el 16 (21:00) y en Tokio ya es el 17 (05:00).
  assertEquals(fallsOnLocalDay("2026-03-16T20:00:00Z", "2026-03-16", MADRID), true);
  assertEquals(fallsOnLocalDay("2026-03-16T20:00:00Z", "2026-03-16", TOKYO), false);
  // 2026-03-16T02:00Z: en Madrid es el 16 (03:00) y en México sigue el 15 (20:00).
  assertEquals(fallsOnLocalDay("2026-03-16T02:00:00Z", "2026-03-16", MADRID), true);
  assertEquals(fallsOnLocalDay("2026-03-16T02:00:00Z", "2026-03-16", MEXICO), false);
});

Deno.test("formatTime usa la zona del usuario", () => {
  assertEquals(formatTime("2026-03-16T08:00:00Z", MADRID), "09:00");
  assertEquals(formatTime("2026-03-16T08:00:00Z", TOKYO), "17:00");
});

Deno.test("isValidChoice filtra lo que venga de la base", () => {
  assertEquals(isValidChoice("both"), true);
  assertEquals(isValidChoice("none"), true);
  assertEquals(isValidChoice("BOTH"), false);
  assertEquals(isValidChoice(null), false);
  assertEquals(isValidChoice(3), false);
});

Deno.test("sanitizeText quita controles y marcas bidireccionales", () => {
  // U+202E (RLO) invierte visualmente lo que viene después.
  assertEquals(sanitizeText("Cita\u202Eexe"), "Citaexe");
  // Caracteres de control, incluidos salto de línea y tabulador.
  assertEquals(sanitizeText("Cita\n\tcon\u0007ruido"), "Cita con ruido");
  // Un nombre con override bidi no debe poder falsear el aviso.
  assertEquals(
    buildBirthdayDispatches(
      [{ id: "c1", name: "Lucía\u202E", birth_date: "1990-03-16" }],
      "same-day",
      ctx("2026-03-16T08:05:00Z", MADRID),
    )[0].body,
    "Es el cumpleaños de Lucía.",
  );
});

Deno.test("isPushEnabled: el interruptor maestro frena todo", () => {
  // Sin fila: hay suscripción activa, luego está consentedido.
  assertEquals(isPushEnabled(null), true);
  assertEquals(isPushEnabled(undefined), true);
  assertEquals(isPushEnabled({ enabled: true }), true);
  assertEquals(isPushEnabled({ enabled: false }), false);
});

Deno.test("las URLs de los avisos están en la allowlist del service worker", () => {
  const allowed = ["/citas", "/cumpleanos"];
  const context = ctx("2026-03-16T08:05:00Z", MADRID);
  const urls = [
    ...buildAppointmentDispatches(
      [{ id: "a1", title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "same-day" }],
      context,
    ),
    ...buildBirthdayDispatches(
      [{ id: "c1", name: "Lucía", birth_date: "1990-03-16" }],
      "same-day",
      context,
    ),
  ];
  assertEquals(urls.length, 2);
  for (const dispatch of urls) {
    assertEquals(allowed.includes(dispatch.url), true);
  }
});

Deno.test("truncate recorta con puntos suspensivos", () => {
  assertEquals(truncate("corto", 10), "corto");
  assertEquals(truncate("1234567890", 5), "1234…");
  assertEquals(truncate("123456 7890", 8), "123456…");
});

Deno.test("cita con reminder none no genera nada", () => {
  const dispatch = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "none" }],
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch, []);
});

Deno.test("cita del mismo día genera un aviso a las 09:00 locales", () => {
  const dispatch = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "same-day" }],
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch.length, 1);
  assertEquals(dispatch[0].slot, "same-day");
  assertEquals(dispatch[0].localDay, "2026-03-16");
  assertEquals(dispatch[0].type, "appointment");
  assertEquals(dispatch[0].url, "/citas");
  assertEquals(dispatch[0].title, "Cita hoy: Dentista");
  // 10:00Z son las 11:00 en Madrid.
  assertEquals(dispatch[0].body, "Dentista a las 11:00.");
});

Deno.test("aviso del día anterior sale un día antes a las 09:00", () => {
  const dispatch = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-17T10:00:00Z", reminder_choice: "day-before" }],
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch.length, 1);
  assertEquals(dispatch[0].slot, "day-before");
  assertEquals(dispatch[0].localDay, "2026-03-16");
  assertEquals(dispatch[0].title, "Cita mañana: Dentista");
});

Deno.test("preferencia both genera los dos avisos cuando toca", () => {
  const dispatch = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-17T10:00:00Z", reminder_choice: "both" }],
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  // 16 por la mañana: solo cabe el aviso de "mañana".
  assertEquals(dispatch.length, 1);
  assertEquals(dispatch[0].slot, "day-before");

  const nextDay = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-17T10:00:00Z", reminder_choice: "both" }],
    ctx("2026-03-17T08:05:00Z", MADRID),
  );
  assertEquals(nextDay.length, 1);
  assertEquals(nextDay[0].slot, "same-day");
});

Deno.test("nada se emite antes de las 09:00 ni después de la ventana", () => {
  const appointment = [{
    id: "a1",
    title: "Dentista",
    starts_at: "2026-03-16T10:00:00Z",
    reminder_choice: "same-day" as const,
  }];

  // Un minuto antes de las 09:00 locales (07:59Z en Madrid).
  assertEquals(buildAppointmentDispatches(appointment, ctx("2026-03-16T07:59:00Z", MADRID)), []);
  // Justo a las 09:00.
  assertEquals(
    buildAppointmentDispatches(appointment, ctx("2026-03-16T08:00:00Z", MADRID)).length,
    1,
  );
  // Fuera de la ventana de 180 min: ya no se reenvía.
  assertEquals(
    buildAppointmentDispatches(appointment, ctx("2026-03-16T12:00:00Z", MADRID)),
    [],
  );
});

Deno.test("la zona horaria del usuario decide la hora del aviso", () => {
  const appointment = [{
    id: "a1",
    title: "Dentista",
    starts_at: "2026-03-16T22:00:00Z",
    reminder_choice: "same-day" as const,
  }];

  // En Ciudad de México (UTC-6) las 22:00Z del 16 son las 16:00 del 16: aún no son las 9.
  assertEquals(buildAppointmentDispatches(appointment, ctx("2026-03-16T23:00:00Z", MEXICO)), []);
  // En Tokio (UTC+9) las 22:00Z del 16 son las 07:00 del 17: el aviso de "hoy" ya pasó.
  assertEquals(buildAppointmentDispatches(appointment, ctx("2026-03-16T23:00:00Z", TOKYO)), []);
});

Deno.test("cita en otro día local no genera aviso", () => {
  const dispatch = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-20T10:00:00Z", reminder_choice: "both" }],
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch, []);
});

Deno.test("reminder_choice inválido se trata como none", () => {
  const dispatch = buildAppointmentDispatches(
    [{ id: "a1", title: "Dentista", starts_at: "2026-03-16T10:00:00Z", reminder_choice: "BOTH" }],
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch, []);
});

Deno.test("cumpleaños: aviso el día anterior", () => {
  const dispatch = buildBirthdayDispatches(
    [{ id: "c1", name: "Lucía", birth_date: "1990-03-17" }],
    "day-before",
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch.length, 1);
  assertEquals(dispatch[0].type, "birthday");
  assertEquals(dispatch[0].slot, "day-before");
  assertEquals(dispatch[0].title, "Cumpleaños mañana: Lucía");
  assertEquals(dispatch[0].body, "Es el cumpleaños de Lucía.");
  assertEquals(dispatch[0].url, "/cumpleanos");
});

Deno.test("cumpleaños: aviso el mismo día", () => {
  const dispatch = buildBirthdayDispatches(
    [{ id: "c1", name: "Lucía", birth_date: "1990-03-16" }],
    "same-day",
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch.length, 1);
  assertEquals(dispatch[0].slot, "same-day");
  assertEquals(dispatch[0].title, "Cumpleaños hoy: Lucía");
});

Deno.test("cumpleaños con choice none no genera nada", () => {
  assertEquals(
    buildBirthdayDispatches(
      [{ id: "c1", name: "Lucía", birth_date: "1990-03-16" }],
      "none",
      ctx("2026-03-16T08:05:00Z", MADRID),
    ),
    [],
  );
});

Deno.test("el 29 de febrero se avisa el 1 de marzo en los años que no son bisiestos", () => {
  // El cambio de comportamiento que motiva el arreglo. Antes, comparando mes-día,
  // la fecha 02-29 no llegaba a existir como día real en 2026 y este cumpleaños no
  // recibía aviso ningún año que no fuera bisiesto. Ahora cae el 1 de marzo, que es
  // lo mismo que hace la app con `new Date(2026, 1, 29)`.
  const contacto = { id: "c1", name: "Rareza", birth_date: "1992-02-29" };

  // El mismo día: el aviso de "hoy" sale con la fecha del 1 de marzo.
  const hoy = buildBirthdayDispatches([contacto], "same-day", ctx("2026-03-01T08:05:00Z", MADRID));
  assertEquals(hoy.length, 1);
  assertEquals(hoy[0].slot, "same-day");
  assertEquals(hoy[0].localDay, "2026-03-01");
  assertEquals(hoy[0].title, "Cumpleaños hoy: Rareza");

  // Y el día antes también: el 28 de febrero se avisa de lo que cae mañana.
  const ayer = buildBirthdayDispatches([contacto], "day-before", ctx("2026-02-28T08:05:00Z", MADRID));
  assertEquals(ayer.length, 1);
  assertEquals(ayer[0].slot, "day-before");
  assertEquals(ayer[0].localDay, "2026-02-28");

  // Con "both" los dos, y ninguno se cuela en un día que no toca.
  const ambos = buildBirthdayDispatches([contacto], "both", ctx("2026-02-28T08:05:00Z", MADRID));
  assertEquals(ambos.length, 1);
  assertEquals(buildBirthdayDispatches([contacto], "both", ctx("2026-03-05T08:05:00Z", MADRID)), []);
});

Deno.test("en un año bisiesto el 29 de febrero se avisa el 29 de febrero", () => {
  // La normalización solo mueve la fecha en los años que no la tienen: en 2028 el
  // 29 de febrero existe y es ese el día que toca.
  const contacto = { id: "c1", name: "Rareza", birth_date: "1992-02-29" };
  const hoy = buildBirthdayDispatches([contacto], "same-day", ctx("2028-02-29T08:05:00Z", MADRID));
  assertEquals(hoy.length, 1);
  assertEquals(hoy[0].localDay, "2028-02-29");
  // Y el 1 de marzo de ese año ya no avisa de nada: el cumpleaños fue ayer.
  assertEquals(buildBirthdayDispatches([contacto], "same-day", ctx("2028-03-01T08:05:00Z", MADRID)), []);
});

Deno.test("cumpleaños en 29 de febrero se ignoran si no coincide el día", () => {
  // Y el caso que no cambia: en un día cualquiera de marzo no hay nada que avisar.
  const dispatch = buildBirthdayDispatches(
    [{ id: "c1", name: "Rareza", birth_date: "2000-02-29" }],
    "same-day",
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch, []);
});

Deno.test("contacto sin fecha de cumpleaños se ignora", () => {
  assertEquals(
    buildBirthdayDispatches(
      [{ id: "c1", name: "Sin fecha", birth_date: null }],
      "both",
      ctx("2026-03-16T08:05:00Z", MADRID),
    ),
    [],
  );
});

Deno.test("cumpleaños de hoy no se duplica por estar en ayer y hoy", () => {
  // Con "both" y cumpleaños hoy, el slot day-before corresponde al día 15, que no
  // es el mes/día del cumpleaños, así que solo sale el aviso de hoy.
  const dispatch = buildBirthdayDispatches(
    [{ id: "c1", name: "Lucía", birth_date: "1990-03-16" }],
    "both",
    ctx("2026-03-16T08:05:00Z", MADRID),
  );
  assertEquals(dispatch.length, 1);
  assertEquals(dispatch[0].slot, "same-day");
});

Deno.test("dedupeKey incluye tipo, referencia, slot, día y zona", () => {
  assertEquals(
    dedupeKey({
      type: "appointment",
      refId: "a1",
      slot: "same-day",
      localDay: "2026-03-16",
      title: "t",
      body: "b",
      url: "/citas",
      userId: "u1",
      timezone: "Europe/Madrid",
    }),
    "appointment:a1:same-day:2026-03-16:Europe/Madrid",
  );
});

Deno.test("dos zonas del mismo usuario NO comparten clave de idempotencia", () => {
  // El reparto agrupa por `(user_id, timezone)`, así que una persona con dos
  // navegadores en zonas distintas produce dos juegos de avisos. Antes de meter la
  // zona en la clave, ambos jogos podían compartir día local y ventana de catchup
  // —offsets a menos de tres horas— y el segundo insert chocaba con la
  // restricción de unicidad. El aviso se perdía para ese navegador y el log decía
  // "skipped (duplicate)": parece una repetición y en realidad es otro
  // dispositivo.
  const base = {
    type: "appointment",
    refId: "a1",
    slot: "same-day",
    localDay: "2026-03-16",
    title: "Dentista",
    body: "b",
    url: "/citas",
    userId: "u1",
  } as const;
  const madrid = dedupeKey({ ...base, timezone: "Europe/Madrid" });
  const lisboa = dedupeKey({ ...base, timezone: "Europe/Lisbon" });
  assert(madrid !== lisboa, "Madrid y Lisboa comparten clave: se perdería un aviso");

  // Y la misma zona dos veces SÍ coincide, que es lo que evita el reenvío.
  assertEquals(dedupeKey({ ...base, timezone: "Europe/Madrid" }), madrid);
});

Deno.test("appointmentQueryUpperBound mira 8 días por delante", () => {
  const now = new Date("2026-03-16T08:05:00Z");
  assertEquals(appointmentQueryUpperBound(now).toISOString(), "2026-03-24T08:05:00.000Z");
});

Deno.test("birthdayChoiceFor: lo que hay en la fila, y nada más", () => {
  // Los cuatro valores se respetan tal cual.
  for (const value of ["none", "day-before", "same-day", "both"] as const) {
    assertEquals(birthdayChoiceFor({ enabled: true, birthday_choice: value }), value);
  }
});

Deno.test("birthdayChoiceFor: sin fila o ilegible avisa de lo mínimo", () => {
  // El fallo que motivó la función: el repliegue era "both", así que sin fila el
  // servidor mandaba los dos avisos mientras Ajustes pintaba "sin aviso". Cliente
  // y servidor afirmaban cosas distintas en el mismo caso.
  //
  // La asimetría con `isPushEnabled` es deliberada: el maestro asume activado sin
  // fila porque llegar al dispatcher ya implica una suscripción viva, o sea un
  // consentimiento previo. Para el *qué* de los cumpleaños no hay esa señal, así
  // que se asume lo mínimo.
  assertEquals(birthdayChoiceFor(null), "none");
  assertEquals(birthdayChoiceFor(undefined), "none");
  assertEquals(birthdayChoiceFor({ enabled: true, birthday_choice: null }), "none");
  assertEquals(birthdayChoiceFor({ enabled: true, birthday_choice: "" }), "none");
  assertEquals(birthdayChoiceFor({ enabled: true, birthday_choice: "BOTH" }), "none");
  assertEquals(birthdayChoiceFor({ enabled: true, birthday_choice: "cada-dos-dias" }), "none");
  // Sin el campo en la fila, que es lo que devuelve una consulta que no lo pide.
  assertEquals(birthdayChoiceFor({ enabled: true }), "none");
});

// ---------------------------------------------------------------------------
// Modo `now`: la confirmación que se pide al recién crear una cita o un cumpleaños.
//
// No comparte código con los recordatorios del cron, y eso es a propósito. El cron
// manda el aviso del evento; esto solo confirma que el evento quedó anotado. Las
// pruebas de este bloque son la red que sostiene esa separación.
// ---------------------------------------------------------------------------

Deno.test("nextBirthdayDay: la siguiente fecha en la que cae el mes y el día", () => {
  // Aún no ha llegado este año: se queda en el mismo año.
  assertEquals(nextBirthdayDay("1990-10-05", "2026-03-16"), "2026-10-05");
  // Ya pasó este año: salta al siguiente.
  assertEquals(nextBirthdayDay("1990-01-05", "2026-03-16"), "2027-01-05");
  // Es hoy mismo: hoy cuenta, no el año que viene. Se comparan cadenas
  // "YYYY-MM-DD", que ordenan igual que cronológicamente.
  assertEquals(nextBirthdayDay("1990-03-16", "2026-03-16"), "2026-03-16");
  // Mañana.
  assertEquals(nextBirthdayDay("1990-03-17", "2026-03-16"), "2026-03-17");
});

Deno.test("nextBirthdayDay: un 29 de febrero cae el 1 de marzo si el año no lo tiene", () => {
  // La convención que decide el usuario: "la próxima vez que aparece esa fecha en el
  // calendario", que es el 1 de marzo. Es la que ya usa la app con
  // `new Date(2026, 1, 29)`, y por eso el aviso del cron y el push de confirmación
  // dicen lo mismo y caen el mismo día. Antes esta función saltaba al próximo año
  // bisiesto (2028) mientras la app agendaba el 1 de marzo de 2027.
  assertEquals(nextBirthdayDay("1992-02-29", "2026-06-20"), "2027-03-01");
  // Antes del 1 de marzo todavía no ha llegado.
  assertEquals(nextBirthdayDay("1992-02-29", "2026-02-28"), "2026-03-01");
  // El 28 exacto: el día anterior, el 1 de marzo es mañana y por tanto el próximo.
  assertEquals(nextBirthdayDay("1992-02-29", "2026-03-01"), "2026-03-01");
  // Pasado el 1 de marzo, el siguiente es el del año que viene.
  assertEquals(nextBirthdayDay("1992-02-29", "2026-03-02"), "2027-03-01");
  // En un año bisiesto el día sí existe, y no se mueve.
  assertEquals(nextBirthdayDay("1992-02-29", "2028-01-05"), "2028-02-29");
  assertEquals(nextBirthdayDay("1992-02-29", "2028-02-28"), "2028-02-29");
  assertEquals(nextBirthdayDay("1992-02-29", "2028-02-29"), "2028-02-29");
  // Y en un bisiesto ya pasado, salta al 1 de marzo del año siguiente.
  assertEquals(nextBirthdayDay("1992-02-29", "2028-03-01"), "2029-03-01");
});

Deno.test("nextBirthdayDay: una fecha que no es 29/02 no se mueve", () => {
  // El caso normal no puede cambiar con el arreglo del 29 de febrero.
  assertEquals(nextBirthdayDay("1990-10-05", "2026-03-16"), "2026-10-05");
  assertEquals(nextBirthdayDay("1990-03-01", "2026-02-28"), "2026-03-01");
  assertEquals(nextBirthdayDay("1990-12-31", "2026-12-31"), "2026-12-31");
  assertEquals(nextBirthdayDay("1990-01-01", "2026-12-31"), "2027-01-01");
});

Deno.test("nextBirthdayDay: nunca devuelve una fecha pasada", () => {
  // Se barre un día de cada mes entre 2024 y 2032 (con bisiestos y centuries
  // dentro) para las tres formas que importan: un 29/02, un 1 de marzo y una fecha
  // normal. La comparación de cadenas de "YYYY-MM-DD" ordena como lo cronológico,
  // así que esto ata que la función no pueda quedarse atrás ni un día.
  const nacimientos = ["1992-02-29", "1992-03-01", "1992-05-17"];
  for (let year = 2024; year <= 2032; year++) {
    for (let month = 1; month <= 12; month++) {
      for (const dia of [1, 15, 28]) {
        const hoy = `${year}-${String(month).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        for (const nacimiento of nacimientos) {
          const siguiente = nextBirthdayDay(nacimiento, hoy);
          assert(siguiente !== null, `${nacimiento} desde ${hoy}`);
          assert(siguiente >= hoy, `${nacimiento} desde ${hoy} devolvio ${siguiente}`);
          // Y nunca se aleja más de un año: la normalización solo salta de marzo.
          assert(siguiente <= addDays(hoy, 366), `${nacimiento} desde ${hoy} devolvio ${siguiente}`);
        }
      }
    }
  }
});

Deno.test("nextBirthdayDay: una fecha que no existe no inventa un cumpleaños", () => {
  // El esquema dice `date not null`, pero el cliente escribe texto y la fila puede
  // venir de una importación. Un valor que no es una fecha no se corrige ni se
  // adivina: se devuelve null y el llamador responde 404.
  assertEquals(nextBirthdayDay("", "2026-03-16"), null);
  assertEquals(nextBirthdayDay("ayer", "2026-03-16"), null);
  assertEquals(nextBirthdayDay("1990-13-05", "2026-03-16"), null);
  assertEquals(nextBirthdayDay("1990-10", "2026-03-16"), null);
  assertEquals(nextBirthdayDay("1990-10-05", "16-03-2026"), null);
  // Un 30 de febrero no existe en ningún año. Normalizarlo al 1 o al 2 de marzo
  // inventaría un cumpleaños que la app tampoco enseña: su `safeDate` descarta la
  // fila entera.
  assertEquals(nextBirthdayDay("1990-02-30", "2026-03-16"), null);
  assertEquals(nextBirthdayDay("1990-04-31", "2026-03-16"), null);
  // Un 29 de febrero en un año que no lo tiene tampoco: la app no puede mostrarlo,
  // así que esta Edge tampoco inventa la fecha.
  assertEquals(nextBirthdayDay("1991-02-29", "2026-03-16"), null);
  assertEquals(nextBirthdayDay("1900-02-29", "2026-03-16"), null);
  // El mismo contacto en un año bisiesto sí vale: es la fila buena.
  assertEquals(nextBirthdayDay("1992-02-29", "2026-03-16"), "2027-03-01");
});

Deno.test("isValidTimeZone: solo pasa lo que Intl entiende", () => {
  assertEquals(isValidTimeZone(MADRID), true);
  assertEquals(isValidTimeZone("UTC"), true);
  assertEquals(isValidTimeZone(""), false);
  assertEquals(isValidTimeZone("Europe/Nowhere"), false);
  assertEquals(isValidTimeZone("no es una zona"), false);
  // Viene de un query param, así que no tiene por qué ser una cadena.
  assertEquals(isValidTimeZone(undefined), false);
  assertEquals(isValidTimeZone(null), false);
  assertEquals(isValidTimeZone(42), false);
  // El tope de 64 caracteres es el `check` de push_subscriptions.timezone, o sea
  // el peor caso que puede venir de nuestra propia base de datos.
  assertEquals(isValidTimeZone("A".repeat(64)), false);
});

Deno.test("now: un cumpleaños fuera de la ventana también se confirma", () => {
  // Este es el fallo que motivó el cambio. Antes, `buildSingleDispatch` usaba
  // `candidatesFor(today, "both")`, que solo produce un candidato si el cumpleaños
  // cae hoy o mañana: un contacto creado con un cumpleaños dentro de tres meses
  // devolvía null y la función no enviaba nada. Es decir, el caso normal de uso
  // no hacía nada.
  const dispatch = buildNowBirthdayDispatch({
    refId: "c1",
    name: "Sofía",
    birthDate: "2020-10-05",
    choice: "both",
    today: "2026-03-16",
  });

  assert(dispatch !== null);
  assertEquals(dispatch.type, "birthday");
  assertEquals(dispatch.refId, "c1");
  assertEquals(dispatch.url, "/cumpleanos");
  assertEquals(dispatch.title, "Cumpleaños: Sofía");
  // Dice la fecha de verdad, no "mañana": el texto del cron ("Cumpleaños mañana:
  // Sofía") habría sido mentira con tres meses de antelación.
  assertEquals(
    dispatch.body,
    "Es el 5 de octubre. Te avisaremos el día antes y el mismo día.",
  );
});

Deno.test("now: un cumpleaños de hoy o mañana se confirma con la fecha correcta", () => {
  const hoy = buildNowBirthdayDispatch({
    refId: "c1",
    name: "Sofía",
    birthDate: "2020-03-16",
    choice: "same-day",
    today: "2026-03-16",
  });
  assert(hoy !== null);
  assertEquals(hoy.body, "Es el 16 de marzo. Te avisaremos el mismo día.");

  const manana = buildNowBirthdayDispatch({
    refId: "c1",
    name: "Sofía",
    birthDate: "2020-03-17",
    choice: "day-before",
    today: "2026-03-16",
  });
  assert(manana !== null);
  assertEquals(manana.body, "Es el 17 de marzo. Te avisaremos el día antes.");
});

Deno.test("now: sin recordatorio configurado no hay nada que confirmar", () => {
  // Es lo que distingue un 404 de un error: el cliente solo lo llama cuando el
  // usuario eligió un recordatorio, así que "none" aquí no es un fallo.
  assertEquals(
    buildNowBirthdayDispatch({
      refId: "c1",
      name: "Sofía",
      birthDate: "2020-10-05",
      choice: "none",
      today: "2026-03-16",
    }),
    null,
  );
  assertEquals(
    buildNowAppointmentDispatch({
      refId: "a1",
      title: "Dentista",
      startsAt: "2026-03-20T10:00:00Z",
      choice: "none",
      timeZone: MADRID,
    }),
    null,
  );
});

Deno.test("now: un contacto sin fecha de cumpleaños no produce nada", () => {
  // La columna es `not null`, pero `buildBirthdayDispatches` ya se defendía contra
  // el null y esta función mantiene la misma defensa: no revienta ni inventa fecha.
  assertEquals(
    buildNowBirthdayDispatch({
      refId: "c1",
      name: "Sofía",
      birthDate: null,
      choice: "both",
      today: "2026-03-16",
    }),
    null,
  );
  // Y una fecha con formato inválido, por el mismo camino.
  assertEquals(
    buildNowBirthdayDispatch({
      refId: "c1",
      name: "Sofía",
      birthDate: "no-es-una-fecha",
      choice: "both",
      today: "2026-03-16",
    }),
    null,
  );
});

Deno.test("now: la cita se confirma con su fecha y su hora, en la zona del usuario", () => {
  const dispatch = buildNowAppointmentDispatch({
    refId: "a1",
    title: "Dentista",
    startsAt: "2026-03-20T10:00:00Z",
    choice: "both",
    timeZone: MADRID,
  });

  assert(dispatch !== null);
  assertEquals(dispatch.type, "appointment");
  assertEquals(dispatch.refId, "a1");
  assertEquals(dispatch.url, "/citas");
  assertEquals(dispatch.title, "Cita: Dentista");
  // 10:00Z en Madrid (UTC+1 en invierno) son las 11:00.
  assertEquals(
    dispatch.body,
    "Es el 20 de marzo a las 11:00. Te avisaremos el día antes y el mismo día.",
  );

  // La misma cita en otra zona da otra hora: por eso la zona se valida antes de
  // llegar aquí y no se usa cruda.
  const tokyo = buildNowAppointmentDispatch({
    refId: "a1",
    title: "Dentista",
    startsAt: "2026-03-20T10:00:00Z",
    choice: "day-before",
    timeZone: TOKYO,
  });
  assert(tokyo !== null);
  assertEquals(
    tokyo.body,
    "Es el 20 de marzo a las 19:00. Te avisaremos el día antes.",
  );
});

Deno.test("now: con una zona que Intl no entiende, el texto sale sin fecha en vez de romperse", () => {
  // `isValidTimeZone` ya rechaza esto antes, pero la función es pura y aquí se la
  // llama directamente: no debe lanzar ni dejar el cuerpo a medias.
  const dispatch = buildNowAppointmentDispatch({
    refId: "a1",
    title: "Dentista",
    startsAt: "2026-03-20T10:00:00Z",
    choice: "same-day",
    timeZone: "Europe/Nowhere",
  });

  assert(dispatch !== null);
  assertEquals(dispatch.title, "Cita: Dentista");
  // Sin fecha, pero con la parte que sí es cierta.
  assertEquals(dispatch.body, "Te avisaremos el mismo día.");
});

Deno.test("now: el texto viene de la casa, así que se sanea como el del cron", () => {
  // El nombre lo escribe cualquier miembro de la casa compartida, y un U+202E
  // (RLO) invertido puede hacer que el aviso parezca otra cosa. Las notificaciones
  // no interpretan HTML pero sí muestran texto, así que el engaño visual existe.
  // Se escribe con escapes y no con el carácter literal: un pegado del fichero con
  // el RLO dentro rompería el fuente, y ya pasó con los controles de `reminders.ts`.
  const conRlo = buildNowBirthdayDispatch({
    refId: "c1",
    name: "Sofía evil‬",
    birthDate: "2020-10-05",
    choice: "same-day",
    today: "2026-03-16",
  });
  assert(conRlo !== null);
  assertEquals(conRlo.title, "Cumpleaños: Sofía evil");
  assert(!conRlo.title.includes("‬"));

  // Y el cuerpo no lleva el nombre, así que el saneo del título no se propaga:
  // el cuerpo solo dice la fecha y qué va a pasar.
  assertEquals(conRlo.body, "Es el 5 de octubre. Te avisaremos el mismo día.");
});

Deno.test("now: un nombre o título largo se recorta", () => {
  const dispatch = buildNowBirthdayDispatch({
    refId: "c1",
    name: "A".repeat(200),
    birthDate: "2020-10-05",
    choice: "both",
    today: "2026-03-16",
  });

  assert(dispatch !== null);
  // El prefijo del título se suma al recorte, igual que en el cron: lo que se
  // acota es el texto que escribe la persona, no la línea completa.
  assert(dispatch.title.startsWith("Cumpleaños: A"));
  assert(dispatch.title.length <= "Cumpleaños: ".length + 60);
  assert(dispatch.title.endsWith("…"));
});

Deno.test("formatMonthDay: un día del calendario no lleva hora ni se desplaza", () => {
  // El cumpleaños no tiene hora. Formatearlo como instante hacía dos cosas malas:
  // a las 00:00Z en Madrid salía "a las 02:00", y en una zona al este de UTC+12 el
  // día se corría al siguiente. El texto acaba en el móvil de alguien, y una hora
  // que no existe es peor que no decir fecha.
  assertEquals(formatMonthDay("2026-10-05"), "5 de octubre");
  assertEquals(formatMonthDay("2026-01-01"), "1 de enero");
  assertEquals(formatMonthDay("2026-12-31"), "31 de diciembre");
  // Un día que no existe no se inventa.
  assertEquals(formatMonthDay("2026-13-01"), "");
  assertEquals(formatMonthDay("2026-00-10"), "");
  assertEquals(formatMonthDay("ayer"), "");
  assertEquals(formatMonthDay(""), "");
});

Deno.test("nowDedupeKey no puede coincidir con la clave del cron", () => {
  // La prueba que más importa de este bloque. `dedupeKey` (la del cron) es
  // `${type}:${refId}:${slot}:${localDay}`; si la confirmación usara la misma
  // forma, insertaría la fila que el cron necesita para el recordatorio de verdad,
  // el cron vería el conflicto 23505 y se saltaría el aviso. El usuario se
  // quedaría sin el recordatorio a cambio de un "ya está avisado".
  //
  // Se calculan las dos claves a la vez para el mismo evento, no solo se asserta
  // el prefijo: es la colisión concreta la que importa, y una clave podría llevar
  // el prefijo y aun así chocar.
  for (const type of ["appointment", "birthday"] as const) {
    for (const refId of ["a1", "c1"]) {
      for (const slot of ["day-before", "same-day"] as const) {
        for (const localDay of ["2026-03-16", "2026-03-17", "2026-10-05"]) {
          const cron = dedupeKey({
            type,
            refId,
            slot,
            localDay,
            title: "t",
            body: "b",
            url: "/",
            userId: USUARIO,
            timezone: "Europe/Madrid",
          });
          const ahora = nowDedupeKey(USUARIO, BUCKET);
          assert(cron !== ahora, `colision: ${type} ${refId} ${slot} ${localDay}`);
        }
      }
    }
  }
});

Deno.test("nowDedupeKey está acotada al bucket y al usuario", () => {
  // El bucket es lo que hace de enfriamiento, y va por usuario: lo que hay que
  // impedir es el bucle de peticiones, no dos avisos del mismo evento.
  assertEquals(nowDedupeKey("u1", 29_000_000), "now:u1:29000000");
  // Mismo bucket, misma clave: el `23505` del segundo intento es lo que corta la
  // vuelta siguiente.
  assertEquals(nowDedupeKey("u1", 29_000_000), nowDedupeKey("u1", 29_000_000));
  assert(nowDedupeKey("u1", 29_000_000) !== nowDedupeKey("u1", 29_000_001));
  // Dos cuentas distintas no se estorban: el enfriamiento es por usuario.
  assert(nowDedupeKey("u1", 29_000_000) !== nowDedupeKey("u2", 29_000_000));
  // Y cabe en el `check` de la columna (char_length <= 200).
  assert(nowDedupeKey(USUARIO, BUCKET).length <= 200);
});
