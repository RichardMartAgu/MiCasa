import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handle } from "./handler.ts";

// La lógica (autenticación, consultas, envío y CORS) está en `handler.ts` para
// que se pueda importar en un test sin que esto levante un servidor.
//
// Se envuelve en una flecha y no se pasa `handle` tal cual: el segundo parámetro
// de un handler de `Deno.serve` es la `ConnInfo`, y `handle` lo usa para inyectar
// el entorno en los tests.
Deno.serve((req) => handle(req));
