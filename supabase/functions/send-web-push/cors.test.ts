import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  corsHeaders,
  DEFAULT_ALLOWED_ORIGINS,
  isOriginAllowed,
  jsonResponse,
  normalizeOrigin,
  parseAllowedOrigins,
  preflightResponse,
  resolveAllowedOrigins,
} from "./cors.ts";
import { handle } from "./handler.ts";

const PROD = "https://micasa-demo.vercel.app";
const AJENO = "https://otro.example";
const FN = "https://sxgsqvwvugdklycpqxiu.supabase.co/functions/v1/send-web-push";

const ALLOWED = resolveAllowedOrigins(undefined);

/**
 * Entorno vacío. El `env` se inyecta justamente para esto: los tests no pueden
 * depender de los secretos que tenga la máquina, y con ellos puestos una
 * petición sin credencial llegaría a leer Vault o a despachar avisos de verdad.
 */
const SIN_ENV = { get: (_name: string): string | undefined => undefined };

Deno.test("el preflight de un origen permitido responde 204 con su ACAO", async () => {
  // Es el bug que se arregla: sin esto el navegador nunca deja pasar el POST
  // del botón "Enviar" de Ajustes.
  const res = await handle(
    new Request(`${FN}?mode=test`, { method: "OPTIONS", headers: { origin: PROD } }),
    SIN_ENV,
  );

  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), PROD);
  assertEquals(res.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assertEquals(res.headers.get("access-control-allow-headers"), "authorization, content-type");
  // Sin esto el navegador repite el preflight en cada "Enviar".
  assert(Number(res.headers.get("access-control-max-age")) > 0);
  assertEquals(res.headers.get("vary"), "Origin");
  assertEquals(await res.text(), "");
});

Deno.test("el preflight de un origen no permitido no lleva ACAO", async () => {
  const res = await handle(
    new Request(`${FN}?mode=test`, { method: "OPTIONS", headers: { origin: AJENO } }),
    SIN_ENV,
  );

  // Lo que importa es que no hay permiso: con o sin ACAO, `fetch` falla igual.
  // El 403 solo sirve para que en los logs se distinga de un despliegue sin CORS.
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  assertEquals(res.status, 403);
});

Deno.test("nunca se devuelve un comodín como ACAO", () => {
  // Con `*` cualquier página podría leer la respuesta, y el allowlist se
  // convertiría en decorativo.
  for (const origin of [PROD, AJENO, "https://micasa-demo.vercel.app.ataque.example", "null"]) {
    assert(corsHeaders(origin, ALLOWED)["Access-Control-Allow-Origin"] !== "*");
  }
});

Deno.test("una respuesta que no es preflight también lleva la cabecera CORS", async () => {
  // Un POST de verdad, con la configuración vacía para no tocar Supabase: sirve
  // para comprobar que el 401 también lleva CORS, porque si el error no lo
  // lleva el navegador no puede ni leer por qué falló.
  const res = await handle(
    new Request(`${FN}?mode=test`, { method: "POST", headers: { origin: PROD } }),
    SIN_ENV,
  );

  assertEquals(res.status, 401);
  assertEquals(res.headers.get("access-control-allow-origin"), PROD);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals((await res.json() as { error: string }).error, "no autorizado");
});

Deno.test("una respuesta normal también lleva ACAO cuando se construye fuera del handler", () => {
  const res = jsonResponse({ ok: true }, 200, corsHeaders(PROD, ALLOWED));

  assertEquals(res.headers.get("access-control-allow-origin"), PROD);
  assertEquals(res.headers.get("vary"), "Origin");
});

Deno.test("una petición sin Origin, la del cron, se comporta como antes", async () => {
  // pg_cron llama por pg_net con `x-cron-secret` y SIN `Origin`. Lo que no puede
  // pasar es que la función empiece a pedir un origen: si lo hiciera, el 401 de
  // abajo sería otro y los recordatorios dejarían de salir.
  const res = await handle(
    new Request(FN, { method: "POST", headers: { "x-cron-secret": "el-que-sea" } }),
    SIN_ENV,
  );

  // Sin CORS, como antes: `corsHeaders` sin Origin solo devuelve `Vary`.
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  assertEquals(res.headers.get("vary"), "Origin");
  // Y sin rechazarla: responde lo mismo que antes de tocar el CORS.
  assertEquals(res.status, 401);
  assertEquals((await res.json() as { error: string }).error, "no autorizado");
});

Deno.test("sin Origin tampoco hay nada que autorizar en el preflight", () => {
  const res = preflightResponse(null, ALLOWED);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  // Sin las cabeceras de método y headers tampoco: no hay a quién autorizarlas.
  assertEquals(res.headers.get("access-control-allow-methods"), null);
});

Deno.test("isOriginAllowed dice que no cuando no hay Origin", () => {
  // El caso del cron, en la función pura: no hay permiso que dar, pero eso no
  // significa que la función tenga que rechazar la petición.
  assertEquals(isOriginAllowed(null, ALLOWED), false);
});

Deno.test("un subdominio hermano de Vercel no está permitido", () => {
  // El ataque de sufijo, y el más probable aquí: en Vercel cualquiera puede
  // desplegar y quedarse con `https://loquesea-abc.vercel.app`. Una comparación
  // por `endsWith`, `includes` o comodín de subdominio dejaría pasar cualquier
  // preview de cualquier cuenta, así que la comparación tiene que ser exacta y
  // esto lo ata.
  assertEquals(isOriginAllowed("https://preview-abc.vercel.app", ALLOWED), false);
  assertEquals(isOriginAllowed("https://otro.vercel.app", ALLOWED), false);
  assertEquals(isOriginAllowed("https://micasa-demo.vercel.app.ataque.example", ALLOWED), false);
  // Y con el usuario embebido, que es la forma clásica de hacer que el host
  // seemingly sea el bueno: la comparación es del origen entero, no del host.
  assertEquals(isOriginAllowed("https://micasa-demo.vercel.app@ataque.example", ALLOWED), false);
  // Un sufijo en otro sitio de la cadena tampoco.
  assertEquals(isOriginAllowed("https://micasa-demo.vercel.app.evil", ALLOWED), false);
});

Deno.test("nunca se concede permiso con cookies", () => {
  // ACAO reflejado + `Access-Control-Allow-Credentials` es lo que convierte un
  // allowlist en CSRF con lectura de respuesta. Aquí no hay cookies: la llamada
  // lleva el JWT en una cabecera. Que nadie lo añada creyendo que "faltaba algo".
  // Con el valor, no con `in`: el tipo de retorno es un `Record<string, string>`,
  // así que `in` siempre daría true y no comprobaría nada.
  assertEquals(corsHeaders(PROD, ALLOWED)["Access-Control-Allow-Credentials"], undefined);
  assertEquals(
    preflightResponse(PROD, ALLOWED).headers.get("access-control-allow-credentials"),
    null,
  );
});

Deno.test("un origen opaco (`null`) nunca está permitido", () => {
  // Es lo que mandan los iframes con sandbox y algunos contexts: es un valor
  // real, no la ausencia de cabecera, y no debe poder compararse con nada.
  assertEquals(isOriginAllowed("null", ALLOWED), false);
});

Deno.test("el ACAO devuelve el origen tal cual, no la versión normalizada", () => {
  // El navegador compara su origen con el valor de la cabecera, así que hay que
  // devolverle exactamente el suyo. La comparación interna sí normaliza, porque
  // la lista de permitidos viene de una variable de entorno escrita a mano.
  const alto = "https://Micasa-Demo.vercel.app";
  assertEquals(isOriginAllowed(alto, ALLOWED), true);
  assertEquals(corsHeaders(alto, ALLOWED)["Access-Control-Allow-Origin"], alto);
});

Deno.test("los orígenes se comparan sin barra final", () => {
  // La lista viene de una variable de entorno que alguien pega a mano; una
  // barra final de más dejaría el botón de Ajustes sin CORS sin error visible.
  assertEquals(normalizeOrigin("https://micasa-demo.vercel.app/"), "https://micasa-demo.vercel.app");
  assertEquals(isOriginAllowed("https://micasa-demo.vercel.app/", ALLOWED), true);
});

Deno.test("parseAllowedOrigins limpia espacios, barras y duplicados", () => {
  assertEquals(
    parseAllowedOrigins(" https://a.example/ , ,https://b.example,https://a.example "),
    ["https://a.example", "https://b.example"],
  );
  assertEquals(parseAllowedOrigins(undefined), []);
  assertEquals(parseAllowedOrigins("  ,  "), []);
});

Deno.test("sin configurar nada vale la lista por defecto, con producción dentro", () => {
  // La lista por defecto tiene que seguir sirviendo aunque nadie configure
  // nada: es lo que hace que el botón funcione recién desplegado.
  assertEquals(resolveAllowedOrigins(undefined), [...DEFAULT_ALLOWED_ORIGINS]);
  assertEquals(isOriginAllowed(PROD, resolveAllowedOrigins(undefined)), true);
  // Configurada y vacía significa "cerrado", no "usa la de por defecto": si no,
  // quien quisiera dejar pasar a nadie acabaría con producción y localhost
  // permitidos, que es justo lo contrario de lo que pidió.
  assertEquals(resolveAllowedOrigins(""), []);
  assertEquals(resolveAllowedOrigins(" , "), []);
  assertEquals(isOriginAllowed(PROD, resolveAllowedOrigins("")), false);
  // Y la lista de por defecto sigue estando cuando no se configura nada, que es lo
  // que hace que un despliegue recién subido funcione sin tocar nada.
  assertEquals(resolveAllowedOrigins(undefined), [...DEFAULT_ALLOWED_ORIGINS]);
});

Deno.test("configurar la lista la sustituye entera, sin mezclar con la de por defecto", () => {
  // Para poder quitar un origen. Quien configura tiene que incluir producción
  // si la quiere: si se olvida, el preflight se responde sin ACAO y se ve
  // enseguida en el navegador.
  const configured = resolveAllowedOrigins("https://preview-123.vercel.app");
  assertEquals(configured, ["https://preview-123.vercel.app"]);
  assertEquals(isOriginAllowed(PROD, configured), false);
  assertEquals(isOriginAllowed("https://preview-123.vercel.app", configured), true);
});
