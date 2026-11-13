/** JSON error envelope shared by every route handler: `{ error: { code, message } }`. */
export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
