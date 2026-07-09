export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
