/**
 * CORS de la Edge Function `send-web-push`.
 *
 * Existe por un motivo concreto: el botón "Enviar" de Ajustes llama a la función
 * desde el navegador con una cabecera `Authorization`, y eso obliga al navegador
 * a mandar un preflight `OPTIONS` antes del `POST`. Un preflight que no recibe
 * `Access-Control-Allow-Origin` hace que el navegador bloquee la llamada, y ese
 * fallo solo aparece en un navegador: con `curl` no hay preflight, así que el
 * botón se podía dar por bueno sin que la llamada hubiera funcionado nunca.
 *
 * Todo aquí es lógica pura, sin I/O ni `Deno.env`, para poder testearlo con
 * `deno test` sin red. `index.ts` solo lo monta en el handler.
 */

/**
 * Orígenes permitidos si no se configura `WEB_PUSH_ALLOWED_ORIGINS`.
 *
 * - `micasa-demo.vercel.app`: la web de producción (alias de Vercel, el único
 *   despliegue web que hay).
 * - `micasa.app`: el dominio propio del proyecto. Todavía no sirve la web, pero
 *   es el origen que tendrá cuando se publique, así que entra desde ahora.
 * - `localhost:8080`: la demo local (`npm run demo`).
 * - `localhost:8081`: el servidor de desarrollo de Expo.
 *
 * Dejar los orígenes de desarrollo aquí es inocuo: un preflight solo puede decir
 * que sí o que no, nunca concede nada, y la autenticación sigue siendo el JWT de
 * la sesión o el secreto del cron. Aun así se pueden quitar con la variable de
 * entorno.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://micasa-demo.vercel.app",
  "https://micasa.app",
  "http://localhost:8080",
  "http://localhost:8081",
];

/** Métodos que la función admite. Una allowlist mínima, no un comodín. */
const ALLOWED_METHODS = "POST, OPTIONS";

/**
 * Cabeceras que el navegador va a mandar y que hay que autorizar: el JWT de la
 * sesión y el tipo de contenido de la petición.
 */
const ALLOWED_HEADERS = "authorization, content-type";

/**
 * Segundos que el navegador puede guardar el preflight. Sin esto, cada "Enviar"
 * cuesta dos peticiones a la función en vez de una.
 */
const PREFLIGHT_MAX_AGE = "3600";

/**
 * Origen en la forma en que se compara: sin barra final y en minúsculas.
 *
 * El navegador ya manda los orígenes normalizados, pero la lista viene de una
 * variable de entorno que alguien pega a mano. Si se cuela una barra final, el
 * botón de Ajustes deja de funcionar sin que nada lo delate: la preflight se
 * responde igual, pero sin permiso. Comparar en minúsculas cubre lo mismo con
 * las mayúsculas.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

/** Lee la lista separada por comas, sin entradas vacías ni duplicados. */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];

  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const origin = normalizeOrigin(part);
    if (origin.length > 0) seen.add(origin);
  }
  return [...seen];
}

/**
 * La lista que se aplica: la de la variable de entorno si hay algo configurado,
 * y la de por defecto si no.
 *
 * Sustituye en lugar de añadir, para que quitar un origen siga siendo posible.
 * Si la variable existe pero solo tiene comas y espacios, se cae a la de por
 * defecto: es un error de configuración, y quedarse sin origen dejaría el botón
 * de Ajustes sin CORS sin explicación.
 */
export function resolveAllowedOrigins(raw: string | null | undefined): string[] {
  // Sin configurar, la lista de por defecto: un despliegue recién subido tiene
  // que funcionar sin que nadie acuerde tocar nada.
  //
  // Configurada y vacía es otra cosa: significa "de aquí no entra nadie", y caer a
  // la lista de por defecto haría justo lo contrario de lo pedido, que es como
  // falla un control de seguridad cuando alguien lo quiere cerrar. Quien quiera
  // dejar la lista de por defecto, que no la configure.
  if (raw === null || raw === undefined) return [...DEFAULT_ALLOWED_ORIGINS];
  return parseAllowedOrigins(raw);
}

/**
 * Si a este origen se le puede devolver `Access-Control-Allow-Origin`.
 *
 * Sin cabecera `Origin` devuelve `false` porque no hay a quién darle permiso,
 * y eso NO es motivo para rechazar la petición: el caller de esta función usa
 * esto para decidir si le da permiso de leer la respuesta, nunca si la atiende.
 * El caso de verdad es `pg_cron`, que llama por `pg_net` sin `Origin` y no es un
 * navegador.
 */
export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (origin === null) return false;
  const normalized = normalizeOrigin(origin);
  return allowed.some((candidate) => normalizeOrigin(candidate) === normalized);
}

/**
 * Cabeceras CORS de cualquier respuesta de la función.
 *
 * `Vary: Origin` va siempre, también sin `Origin`: la respuesta depende de él y
 * sin esa cabecera una caché intermedia podría servir a un origen la respuesta
 * preparada para otro. `Vary` no concede nada, así que no daña el caso del cron.
 *
 * El valor devuelto es el `Origin` tal cual llegó, no el normalizado: es el
 * navegador quien tiene que reconocerse en la cabecera, y comparar con una
 * versión reescrita no serviría. Reflejar el valor del cliente no abre una vía de
 * inyección de cabeceras: el navegador solo serializa orígenes, y un cliente que
 * mandara un CR o LF en la cabecera lo haría en bruto, donde la petición ni
 * siquiera se parsea (y `Headers` rechaza ese valor).
 */
export function corsHeaders(
  origin: string | null,
  allowed: readonly string[],
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin !== null && isOriginAllowed(origin, allowed)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/**
 * Respuesta JSON con las cabeceras CORS ya resueltas. Todas las respuestas de la
 * función salen de aquí, también las de error: si el 401 o el 405 no llevan
 * `Access-Control-Allow-Origin`, el navegador no puede ni leer por qué falló y
 * solo enseña un error genérico.
 */
export function jsonResponse(
  body: unknown,
  status = 200,
  cors: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/**
 * Respuesta al preflight.
 *
 * - Origen permitido: `204` con lo que el navegador necesita para dejar pasar la
 *   petición real.
 * - Origen no permitido: `403` **sin** `Access-Control-Allow-Origin`. El
 *   navegador lo bloquea igual que con un `204` sin cabeceras (para `fetch`, los
 *   dos son un error de red), pero en los logs de la función se distingue un
 *   origen no autorizado de un despliegue al que se le olvidó el CORS.
 * - Sin `Origin`: `204` con solo `Vary: Origin`. Un navegador nunca manda un
 *   preflight sin origen; eso solo pasa con `curl`, y no hay nada que autorizar.
 */
export function preflightResponse(
  origin: string | null,
  allowed: readonly string[],
): Response {
  if (origin !== null && !isOriginAllowed(origin, allowed)) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }

  const headers = corsHeaders(origin, allowed);
  if (origin !== null) {
    headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS;
    headers["Access-Control-Allow-Headers"] = ALLOWED_HEADERS;
    headers["Access-Control-Max-Age"] = PREFLIGHT_MAX_AGE;
  }
  return new Response(null, { status: 204, headers });
}
