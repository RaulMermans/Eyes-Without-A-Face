import { SOURCE_LIMITS } from "./limits.ts";
import { normalizeRestJson } from "./json.ts";
import type { NormalizedSource } from "./types.ts";

/**
 * Read-only REST JSON connector (Sprint 13, Workstream C).
 *
 * Capabilities: one bounded HTTPS GET of a JSON list, parsed locally, after
 * an explicit user action. It cannot insert, update or delete anything: the
 * request method is fixed to GET, it has no body, and there is no other
 * method in this module.
 *
 * Safety:
 *   - HTTPS only, default port only, a DNS host name (no IP literals, no
 *     localhost / single-label / private-suffix hosts), no user:password in
 *     the URL, and no credential-like query parameters;
 *   - browser CORS applies (no proxy, no bypass); cookies are never sent
 *     (`credentials: "omit"`) and no referrer is sent;
 *   - redirects are refused, so an optional bearer token can only reach the
 *     origin the user confirmed;
 *   - a timeout, a response-size cap enforced while streaming, a JSON content
 *     type, and strict JSON parsing;
 *   - the token lives only in the caller's memory for the duration of the
 *     request. It is never stored, logged, exported or put into any payload.
 */
export type ConnectorProblemCode =
  | "INVALID_URL"
  | "NOT_HTTPS"
  | "PORT_NOT_ALLOWED"
  | "PRIVATE_HOST"
  | "CREDENTIALS_IN_URL"
  | "INVALID_TOKEN"
  | "NETWORK_OR_CORS"
  | "TIMEOUT"
  | "REDIRECT_REFUSED"
  | "AUTH_FAILED"
  | "HTTP_ERROR"
  | "NOT_JSON"
  | "TOO_LARGE"
  | "CANCELLED"
  | "NORMALIZE_FAILED";

export interface ConnectorProblem {
  code: ConnectorProblemCode;
  message: string;
}

export const REST_CONNECTOR = {
  id: "rest-json",
  label: "Read-only REST API (JSON)",
  capabilities: { read: true, write: false, methods: ["GET"] as const, auth: ["none", "bearer"] as const, requiresCors: true },
} as const;

export type EndpointCheck = { ok: true; url: URL; origin: string; host: string } | { ok: false; problem: ConnectorProblem };

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".home.arpa", ".corp", ".private", ".localdomain"];
const CREDENTIAL_PARAM = /^(api[-_]?key|apikey|key|token|access[-_]?token|id[-_]?token|refresh[-_]?token|auth|authorization|bearer|password|passwd|pwd|secret|client[-_]?secret|sig|signature|session|sessionid|jwt)$/i;

function fail(code: ConnectorProblemCode, message: string): { ok: false; problem: ConnectorProblem } {
  return { ok: false, problem: { code, message } };
}

export function validateEndpoint(input: string): EndpointCheck {
  const text = input.trim();
  if (!text) return fail("INVALID_URL", "Enter the HTTPS address of a JSON API.");
  if (text.length > 2048) return fail("INVALID_URL", "The address is too long.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail("INVALID_URL", "This is not a valid web address. It should look like https://api.example.com/customers.");
  }
  if (url.protocol !== "https:") return fail("NOT_HTTPS", "Only HTTPS addresses are allowed.");
  if (url.username || url.password) return fail("CREDENTIALS_IN_URL", "Remove the user name and password from the address. Use the token field instead.");
  if (url.port) return fail("PORT_NOT_ALLOWED", "Only the standard HTTPS port is allowed. Remove the port number from the address.");
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host) || /^[0-9a-f:]+$/.test(host)) {
    return fail("PRIVATE_HOST", "Use the API's domain name, not an IP address.");
  }
  if (!host.includes(".") || host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return fail("PRIVATE_HOST", "Local and private-network hosts are not allowed. Use a public HTTPS API.");
  }
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_PARAM.test(key)) {
      return fail("CREDENTIALS_IN_URL", `Remove "${key}" from the address. Credentials in a URL can leak through history and logs; use the token field instead.`);
    }
  }
  url.hash = "";
  return { ok: true, url, origin: url.origin, host };
}

export function validateToken(token: string): ConnectorProblem | null {
  if (!token) return null;
  if (token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) return { code: "INVALID_TOKEN", message: "The token must be a single line of printable characters without spaces." };
  return null;
}

export interface RestReadOptions {
  url: string;
  /** Optional bearer token. Kept by the caller in memory only. */
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
}

export type RestReadResult = { ok: true; value: NormalizedSource } | { ok: false; problem: ConnectorProblem };

async function readCapped(response: Response, limit: number): Promise<{ ok: true; text: string; bytes: number } | { ok: false }> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > limit) return { ok: false };
    return { ok: true, text: decoder.decode(buffer), bytes: buffer.length };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, text: decoder.decode(all), bytes };
}

/** One explicit, bounded, read-only GET. Never retried automatically. */
export async function readRestSource(options: RestReadOptions): Promise<RestReadResult> {
  const endpoint = validateEndpoint(options.url);
  if (!endpoint.ok) return endpoint;
  const token = options.token?.trim() ?? "";
  const tokenProblem = validateToken(token);
  if (tokenProblem) return { ok: false, problem: tokenProblem };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? SOURCE_LIMITS.restTimeoutMs;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    let response: Response;
    try {
      response = await fetchImpl(endpoint.url.toString(), {
        method: "GET",
        headers,
        credentials: "omit",
        mode: "cors",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      if (timedOut) return fail("TIMEOUT", `The API did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      if (options.signal?.aborted) return fail("CANCELLED", "The connection was cancelled.");
      return fail(
        "NETWORK_OR_CORS",
        "The browser could not read this API. Either it is unreachable, or it does not allow requests from this site (CORS). EYES does not use a proxy to get around this.",
      );
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      return fail("REDIRECT_REFUSED", "The API answered with a redirect. Redirects are not followed; use the final address instead.");
    }
    if (response.status === 401 || response.status === 403) {
      return fail("AUTH_FAILED", token ? "The API refused the token (HTTP " + response.status + "). Check that it is valid and allows read access." : "The API requires authentication (HTTP " + response.status + "). Add a read-only bearer token.");
    }
    if (!response.ok) return fail("HTTP_ERROR", `The API answered with HTTP ${response.status}. Nothing was imported.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/([a-z0-9.+-]*\+)?json\b/i.test(contentType.trim())) {
      return fail("NOT_JSON", "The API did not return JSON (content type is not application/json).");
    }
    const declared = Number(response.headers.get("content-length") ?? "NaN");
    if (Number.isFinite(declared) && declared > SOURCE_LIMITS.maxTextBytes) {
      return fail("TOO_LARGE", `The response is larger than ${SOURCE_LIMITS.maxTextBytes} bytes. Ask the API for fewer records (for example with a limit parameter).`);
    }
    let body: Awaited<ReturnType<typeof readCapped>>;
    try {
      body = await readCapped(response, SOURCE_LIMITS.maxTextBytes);
    } catch {
      if (timedOut) return fail("TIMEOUT", `The API did not finish answering within ${Math.round(timeoutMs / 1000)} seconds.`);
      return fail("NETWORK_OR_CORS", "The response could not be read completely.");
    }
    if (!body.ok) {
      return fail("TOO_LARGE", `The response is larger than ${SOURCE_LIMITS.maxTextBytes} bytes. Ask the API for fewer records (for example with a limit parameter).`);
    }
    const now = (options.now ?? (() => new Date()))();
    const path = endpoint.url.pathname;
    const normalized = normalizeRestJson(
      body.text,
      { kind: "connector", origin: endpoint.origin, path, byteLength: body.bytes, status: response.status, retrievedAt: now.toISOString() },
      `${endpoint.host}${path === "/" ? "" : path}`,
    );
    if (!normalized.ok) return fail("NORMALIZE_FAILED", normalized.problem.message);
    return normalized;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
