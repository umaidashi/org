import type { GithubWebhookInput } from './github-webhook.js';
import type { Event } from './domain.js';
export async function receiveGithubWebhook(
  request: Request,
  repository: string,
  receive: (input: GithubWebhookInput) => Event,
  available: () => boolean,
): Promise<Response> {
  const rejected = (status: number) => new Response('Webhook rejected', { status });
  if (!available()) return rejected(503);
  if (new URL(request.url).pathname !== '/hooks/github') return rejected(404);
  if (request.method !== 'POST') return rejected(405);
  if (request.headers.get('x-github-event') !== 'issues') return rejected(400);
  try {
    const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await request.arrayBuffer(),
    );
    if (!available()) return rejected(503);
    const event = receive({
      repository,
      body,
      signature: request.headers.get('x-hub-signature-256') ?? '',
      delivery: request.headers.get('x-github-delivery') ?? '',
    });
    return Response.json({ id: event.id }, { status: 202 });
  } catch {
    return rejected(400);
  }
}
