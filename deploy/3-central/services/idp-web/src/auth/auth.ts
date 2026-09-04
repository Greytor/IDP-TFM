/* Sin autenticación en esta edición del repositorio (ver AuthProvider.tsx).

   Se conserva `getAccessToken` porque el cliente HTTP la llama en cada petición.
   Al devolver `null`, no se añade cabecera `Authorization` y la API —que aquí
   tampoco valida nada— responde con normalidad.

   Reponer autenticación es devolver aquí un token real: `client.ts` no cambia. */
export function getAccessToken(): string | null {
  return null;
}
