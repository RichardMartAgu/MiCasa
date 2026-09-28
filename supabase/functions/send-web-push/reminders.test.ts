import { assertEquals } from "jsr:@std/assert@1";

import {
  addDays,
  appointmentQueryUpperBound,
  buildAppointmentDispatches,
  buildBirthdayDispatches,
  dedupeKey,
  fallsOnLocalDay,
  formatTime,
  candidatesFor,
  isPushEnabled,
  isValidChoice,
  localDayUtc,
  sanitizeText,
  nineAmUtc,
  truncate,
  type Context,
} from "./reminders.ts";

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

Deno.test("cumpleaños en 29 de febrero se ignoran si no coincide el día", () => {
  // 2026 no es bisiesto, así que el 29/02 no existe como fecha local válida.
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

Deno.test("dedupeKey incluye tipo, referencia, slot y día", () => {
  assertEquals(
    dedupeKey({
      type: "appointment",
      refId: "a1",
      slot: "same-day",
      localDay: "2026-03-16",
      title: "t",
      body: "b",
      url: "/citas",
    }),
    "appointment:a1:same-day:2026-03-16",
  );
});

Deno.test("appointmentQueryUpperBound mira 8 días por delante", () => {
  const now = new Date("2026-03-16T08:05:00Z");
  assertEquals(appointmentQueryUpperBound(now).toISOString(), "2026-03-24T08:05:00.000Z");
});
