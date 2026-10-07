/**
 * Suscripciones que no pueden volver a funcionar.
 *
 * El caso que motiva el fichero: en producción había una fila con `p256dh` de
 * nueve caracteres. Pasa cualquier validación de forma —es base64url, no hay
 * espacios, no está vacía— y es imposible de cifrar, así que `web-push` lanzaba
 * un `TypeError` al descifrar. Como el fallo no era 404 ni 410, la fila no se
 * borraba nunca: el botón de aviso de prueba fallaba con un error de criptografía
 * en la cara de la persona, y el dispatcher la reintentaba cada cinco minutos
 * para siempre.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isUnusableSubscription } from "./handler.ts";

/**
 * Un error con el mensaje del criptográfico.
 *
 * Deliberadamente NO es `TypeError`. web-push@3.6.7 no lanza ni uno: todo lo que
 * no es respuesta HTTP es `Error` plano. Devolver aquí un `TypeError` habría
 * hecho pasar la suite sin comprobar nada, porque el predicado ya no distingue
 * por tipo y por tanto aceptaría cualquier `Error`.
 */
function errorDeClaves(mensaje: string): Error {
  return new Error(mensaje);
}

Deno.test("unas claves que no se pueden descifrar hacen la suscripción inservible", () => {
  // El caso medido en producción. El texto literal es el que lanza
  // `encryption-helper.js` cuando el `p256dh` no mide los 65 bytes que debería tener: nueve
  // caracteres sí pasan la validación de forma, así que llegan hasta aquí.
  assert(isUnusableSubscription(
    errorDeClaves("The subscription p256dh value should be 65 bytes long."),
  ));
  assert(isUnusableSubscription(errorDeClaves("The subscription p256dh value should be 65 bytes long.")));
});

Deno.test("un error que no habla de claves NO hace la suscripción inservible", () => {
  // La asimetría es deliberada y sale del coste de equivocarse. Clasificar de más
  // borra la suscripción de un usuario de verdad y pierde sus avisos para
  // siempre; clasificar de menos cuesta un intento más y un fallo más en el
  // contador. Ante la duda, se conserva.
  assertEquals(isUnusableSubscription(
    errorDeClaves("Cannot read properties of undefined (reading 'byteLength')"),
  ), false);
  assertEquals(isUnusableSubscription(errorDeClaves("x is not a function")), false);
});

Deno.test("un fallo de red NO hace la suscripción inservible", () => {
  // Si esto se clasificara como inservible, un fallo de red de un segundo
  // borraría la suscripción de un usuario de verdad y perdería sus avisos para
  // siempre. Es el error más caro de confundir.
  assertEquals(isUnusableSubscription(new Error("fetch failed")), false);
  // "decode" a secas no basta: solo los literales del criptográfico clasifican.
  assertEquals(isUnusableSubscription(new Error("Failed to decode base64url")), false);
  assertEquals(isUnusableSubscription(new Error("network timeout")), false);
});

Deno.test("un error con statusCode sigue sin ser inservible", () => {
  // El 429 y el 500 del servicio de push son transitorios. El llamador ya los
  // trata con su contador de fallos, y Borrarlos sería tirar la suscripción de
  // alguien porque el servicio tuvo mal día.
  const conEstado = Object.assign(new Error("too many requests"), { statusCode: 429 });
  assertEquals(isUnusableSubscription(conEstado), false);
  const conEstado500 = Object.assign(new Error("internal"), { statusCode: 500 });
  assertEquals(isUnusableSubscription(conEstado500), false);
});

Deno.test("un 404 o 410 no llega aquí, pero tampoco se rompería", () => {
  const caduca = Object.assign(new Error("gone"), { statusCode: 410 });
  assertEquals(isUnusableSubscription(caduca), false);
});

Deno.test("nada raro se clasifica como inservible", () => {
  assertEquals(isUnusableSubscription(null), false);
  assertEquals(isUnusableSubscription(undefined), false);
  assertEquals(isUnusableSubscription("una cadena"), false);
  assertEquals(isUnusableSubscription(new TypeError("")), false);
});

Deno.test("los mensajes REALES de encryption-helper SÍ borran la suscripción", () => {
  // Estos cuatro textos son literales de web-push@3.6.7, y ninguno es un
  // `TypeError`: todos son `Error` plano. Una versión anterior del predicado
  // exigía `instanceof TypeError` y por eso los clasificaba como "transitorio":
  // la fila con `p256dh` de nueve caracteres —el caso que motivó este fichero—
  // pasaba por el contador y quedaba apagada a los cinco intentos, sin log.
  for (const mensaje of [
    "The subscription p256dh value must be a string.",
    "The subscription p256dh value should be 65 bytes long.",
    "The subscription auth key must be a string.",
    "The subscription auth key should be at least 16 bytes long.",
  ]) {
    assertEquals(
      isUnusableSubscription(new Error(mensaje)),
      true,
      `un dato de suscripción inservible no se detectó: ${mensaje}`,
    );
  }
});

Deno.test("los literales de web-push-lib.js SÍ borran la suscripción", () => {
  // `generateRequestDetails` valida la suscripción antes de cifrar, y sus mensajes
  // no coinciden con ninguno de `encryption-helper.js`. Una suscripción con `p256dh`
  // o `auth` vacíos nunca llega al descifrado, así que sin estos marcadores pasaba
  // por el contador y a los cinco ciclos quedaba apagada: la pérdida silenciosa que
  // este módulo existe para evitar.
  for (const mensaje of [
    "To send a message with a payload, the subscription must have 'auth' and 'p256dh' keys.",
    "The subscription endpoint must be a string with a valid URL.",
    "You must pass in a subscription with at least an endpoint.",
  ]) {
    assertEquals(
      isUnusableSubscription(new Error(mensaje)),
      true,
      `una suscripción inservible no se detectó: ${mensaje}`,
    );
  }
});

Deno.test("un error de configuración VAPID NO borra la suscripción de nadie", () => {
  // Estos texts hablan de "key" y de "Base 64", así que un predicado laxo los
  // confundiría con el criptográfico. Si llegaran aquí, una clave VAPID mal
  // puesta borraría la suscripción de toda la flota. Literales de
  // `vapid-helper.js` y de `getVapidHeaders`.
  for (const mensaje of [
    "Vapid public key must be a URL safe Base 64 (without \"=\")",
    "Vapid private key should be 65 bytes long when decoded.",
    "VAPID audience is not a url.",
    "No subject set in vapidDetails.subject.",
    "Vapid subject is not a valid URL. mailto:not-a-url",
  ]) {
    assertEquals(
      isUnusableSubscription(new Error(mensaje)),
      false,
      `un error de configuración VAPID borró suscripciones: ${mensaje}`,
    );
  }
});

Deno.test("una clave VAPID que revienta en el criptográfico TAMPOCO borra suscripciones", () => {
  // Este caso es el que hace que el filtro de VAPID exista, y no uno puramente
  // teórico.
  //
  // `validatePublicKey` solo comprueba que la clave sea base64url y mida 65
  // bytes. Una cadena de 65 bytes que no es una clave pública real pasa esa
  // comprobación y llega a `createECDH`, que lanza con el mismo tipo de mensaje
  // que usa el criptográfico de la suscripción: "error:1E08010C:DECODER
  // routines::unsupported" o un fallo de curva elíptica.
  //
  // Es decir: el mensaje que hoy dice "esta suscripción de esta persona está
  // rota" lo puede producir una clave VAPID del servidor que está mal puesta, y
  // es un error de configuración compartido por todos los usuarios a la vez. Sin
  // el filtro, la primera ejecución con una VAPID corrupta borraba la suscripción
  // de todo el mundo. Esto ata esa protección: quitar el filtro pone esto en rojo.
  for (const mensaje of [
    "error:1E08010C:DECODER routines::unsupported",
    "invalid elliptic curve point",
    "error:1E08010C:DECODER routines::unsupported while decoding the VAPID public key",
  ]) {
    assertEquals(
      isUnusableSubscription(new Error(mensaje)),
      false,
      `una clave VAPID rota borró suscripciones de gente: ${mensaje}`,
    );
  }
});

Deno.test("un error que menciona 'key' sin nombrar la suscripción NO la borra", () => {
  // El predicado era `includes("key")`, y esto lo clasificaba como inservible:
  // un error que casualmente hable de "key" por otro motivo terminaba en el mismo
  // `catch` que el descifrado y eliminaba la fila. Borrar no lo revierte nada del
  // lado del servidor —solo se recupera si la persona apaga y enciende el push a
  // mano—, así que el falso positivo le costaba a alguien real todos sus avisos
  // por un error que no tenía nada que ver con sus claves.
  //
  // Estos dos casos no son "!key suelto" sino algo más fuerte: son errores del
  // criptográfico sin atribuir. La lista se estrechó hasta NO incluir "decoder" ni
  // "elliptic" a secas por el motivo del test de VAPID de arriba: no se puede
  // saber de quién es la culpa. Conservar cuesta un reintento; borrar cuesta
  // todos los avisos de una persona.
  assertEquals(isUnusableSubscription(errorDeClaves("Cannot read property 'key' of undefined")), false);
  assertEquals(isUnusableSubscription(errorDeClaves("undefined is not a key map")), false);
  // El error de OpenSSL ("DECODER routines::unsupported") sí clasifica, pero por
  // lo que dice, no por la palabra "decode": un `decodeURIComponent` malformado
  // no dice nada de claves.
  assertEquals(isUnusableSubscription(errorDeClaves("URIError: malformed decodeURIComponent")), false);
  assertEquals(isUnusableSubscription(errorDeClaves("The subscription must be a string")), false);
});

Deno.test("un mensaje de VAPID que nombre material de suscripción TAMPOCO borra", () => {
  // Este es el único caso donde el filtro de VAPID es load-bearing hoy, y por eso
  // existe.
  //
  // Todos los mensajes de `vapid-helper.js` que nombran una clave dicen "public
  // key" o "private key", nunca "p256dh" ni "auth key", así que hoy la lista
  // estrecha ya los rechaza sin necesidad del filtro. Si alguien ampliase la lista
  // con "public key" o con algo que los alcance, este test es lo que lo para.
  //
  // Sin este filtro, ese mismo refactor borraría la suscripción de todas las casas
  // en la primera ejecución, y sin ningún log que lo explicara.
  for (const mensaje of [
    "Vapid public key must be a URL safe Base 64 (without \"=\")",
    "Vapid private key must be a URL safe Base 64 encoded string.",
    "No key set in vapidDetails.privateKey",
    "vapid p256dh material is corrupt",
  ]) {
    assertEquals(
      isUnusableSubscription(new Error(mensaje)),
      false,
      `un mensaje de VAPID borró suscripciones: ${mensaje}`,
    );
  }
});

Deno.test("ampliar la lista NO puede reintroducir el borrado por error de VAPID", () => {
  // Este test existe por una historia concreta, no por cobertura.
  //
  // La protección contra "un error del criptográfico borra la flota" está en dos
  // sitios que se pueden refactorizar por separado: el filtro de VAPID, y el hecho
  // de que la lista NO incluya "decoder", "elliptic" ni "diffie" a secas. Cuando
  // alguien amplia esa lista —y ampliar la lista parece inocuo, es solo añadir una
  // palabra— tiene que fallar esto.
  //
  // Se comproban las tres formas: el filtro, y las dos palabras que más tentación
  // dan de añadir porque describen fallos reales de descifrado.
  const conVapid = (m: string) => isUnusableSubscription(new Error(m));
  for (const palabra of ["decoder", "elliptic", "diffie", "aes128gcm"]) {
    assertEquals(
      conVapid(`some ${palabra} failure from an unattributable source`),
      false,
      `la palabra "${palabra}" borra suscripciones sin poder atribuir el fallo`,
    );
  }

  // Y el caso con el que se rompió de verdad: alguien añade "base64" a la lista
  // para cubrir un mensaje de VAPID, y con ello borra a todo el mundo.
  assertEquals(
    conVapid("Vapid public key must be a URL safe Base 64 (without \"=\")"),
    false,
    "un mensaje de clave VAPID borró suscripciones de toda la flota",
  );
});

