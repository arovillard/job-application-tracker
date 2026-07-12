type RequestFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
}

export async function deleteOpportunityRequest(request: RequestFunction, url: string, redirect: (url: string) => void) {
  const response = await request(url, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
  redirect("/");
}
