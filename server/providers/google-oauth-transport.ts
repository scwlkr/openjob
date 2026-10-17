import type { OAuth2Client } from 'google-auth-library';

export type GoogleOAuthTransport = typeof fetch;
export class GoogleOAuthAdapterError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Google authorization: ${code.replaceAll('_', ' ')}.`); this.code = code; this.name = 'GoogleOAuthAdapterError'; }
}
export function googleOAuthFail(code: string): never { throw new GoogleOAuthAdapterError(code); }

const endpoints = new Map([
  ['https://oauth2.googleapis.com/token', 'POST'],
  ['https://oauth2.googleapis.com/tokeninfo', 'POST'],
  ['https://www.googleapis.com/oauth2/v1/certs', 'GET'],
]);
const RESPONSE_LIMIT = 128_000;

/** Explicit injection only: never fall back to global fetch, ADC or mailbox APIs. */
export function configureGoogleOAuthTransport(client: OAuth2Client, transport: GoogleOAuthTransport) {
  client.transporter.interceptors.request.add({ resolved: async options => {
    // The library opts into retries on token POSTs. A consumed code or uncertain
    // refresh must not be replayed automatically by this adapter.
    options.retry = false;
    options.retryConfig = { retry: 0, noResponseRetries: 0 };
    options.maxRedirects = 0;
    options.timeout = 10_000;
    return options;
  } });
  client.transporter.defaults.fetchImplementation = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (endpoints.get(url) !== (init?.method ?? 'GET').toUpperCase()) googleOAuthFail('transport_denied');
    const response = await transport(input, { ...init, redirect: 'error' });
    if (response.status >= 300 && response.status < 400) googleOAuthFail('transport_denied');
    if (!response.body) return response;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > RESPONSE_LIMIT) googleOAuthFail('response_too_large');
        parts.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
}
