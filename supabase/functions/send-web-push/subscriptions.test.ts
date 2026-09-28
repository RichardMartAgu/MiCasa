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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assert, assertEquals } from "jsr:@std/assert@1";
import { isUnusableSubscription } from "./handler.ts";

/** Un `TypeError` como el que lanza `web-push` al descifrar claves. */
function errorDeClaves(mensaje: string): TypeError {
  return new TypeError(mensaje);
}

Deno.test("unas claves que no se pueden descifrar hacen la suscripción inservible", () => {
  // El caso medido en producción, literalmente.
  assert(isUnusableSubscription(
    errorDeClaves("Failed to decode base64url: invalid character"),
  ));
  assert(isUnusableSubscription(errorDeClaves("Cannot decode the p256dh key")));
});

Deno.test("un TypeError que no habla de claves NO hace la suscripción inservible", () => {
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
  assertEquals(isUnusableSubscription(new TypeError("fetch failed")), false);
  assertEquals(isUnusableSubscription(new Error("Failed to decode base64url")), false);
  assertEquals(isUnusableSubscription(new TypeError("network timeout")), false);
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

/**
 * Los dos sitios que limpian suscripciones tienen que usar el clasificador.
 *
 * Necesita `--allow-read` en el comando de `deno test`, que es el que queda
 * documentado en `docs/web-push.md`. Es una bandera más porque este test lee el
 * fuente, y a cambio es el único que ata el cableado.
 *
 * Es un test sobre el fuente, y normalmente eso es mala señal. Aquí lo es menos:
 * los dos `catch` que deciden entre borrar una suscripción y reintentarla hacen
 * falta para probarlos de verdad, y eso exigiría inyectar `web-push` y la base de
 * datos en un módulo que a propósito no los recibe. El clasificador sí está
 * probado en comportamiento, aquí lo que se ata es el cableado: sin este test,
 * quitar el clasificador de los dos `catch` deja la suite en verde y el bug
 * vuelve, que es justo lo que pasó al primer intento.
 */
Deno.test("los dos sitios de envio clasifican la suscripcion inservible", () => {
  const fuente = readFileSync(join(import.meta.dirname!, "handler.ts"), "utf-8");
  // La llamada aparece en los dos `catch` que deciden entre borrar la suscripción
  // y reintentarla: el reparto y el aviso de prueba. Uno está pegado al 404 y el
  // otro en su propio `if`, así que se cuenta la llamada y no una forma concreta.
  const usos = fuente.match(/isUnusableSubscription\(error\)/g) ?? [];

  // Dos, ni uno más ni uno menos. La declaración de la función lleva
  // `error: unknown`, así que no cuenta como llamada.
  assertEquals(usos.length, 2);
});
