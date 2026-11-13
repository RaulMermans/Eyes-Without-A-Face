import { describe, expect, it } from "vitest";
import { readRestSource, REST_CONNECTOR, validateEndpoint, validateToken } from "../../src/sources/rest.ts";
import { REST_ADAPTER, toImportedSource } from "../../src/sources/adapter.ts";
import { SOURCE_LIMITS } from "../../src/sources/limits.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const RECORDS = [
  { id: "C-1", email: "ada@example.com" },
  { id: "C-2", email: "bo@example.com" },
];

describe("CON-URL endpoint validation (no I/O)", () => {
  it("CON-URL-001 accepts a public HTTPS JSON endpoint and drops the fragment", () => {
    const check = validateEndpoint("https://api.example.com/v1/customers?limit=20#x");
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.host).toBe("api.example.com");
      expect(check.url.toString()).toBe("https://api.example.com/v1/customers?limit=20");
    }
  });

  it.each([
    ["", "INVALID_URL"],
    ["not a url", "INVALID_URL"],
    ["http://api.example.com/x", "NOT_HTTPS"],
    ["ftp://api.example.com/x", "NOT_HTTPS"],
    ["javascript:alert(1)", "NOT_HTTPS"],
    ["https://user:pw@api.example.com/x", "CREDENTIALS_IN_URL"],
    ["https://api.example.com/x?api_key=abc", "CREDENTIALS_IN_URL"],
    ["https://api.example.com/x?access_token=abc", "CREDENTIALS_IN_URL"],
    ["https://api.example.com:8443/x", "PORT_NOT_ALLOWED"],
    ["https://localhost/x", "PRIVATE_HOST"],
    ["https://127.0.0.1/x", "PRIVATE_HOST"],
    ["https://2130706433/x", "PRIVATE_HOST"],
    ["https://10.0.0.5/x", "PRIVATE_HOST"],
    ["https://192.168.1.1/x", "PRIVATE_HOST"],
    ["https://[::1]/x", "PRIVATE_HOST"],
    ["https://intranet/x", "PRIVATE_HOST"],
    ["https://printer.local/x", "PRIVATE_HOST"],
    ["https://db.internal/x", "PRIVATE_HOST"],
    ["https://app.localhost/x", "PRIVATE_HOST"],
  ])("CON-URL-002 refuses %s (%s)", (url, code) => {
    const check = validateEndpoint(url);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.problem.code).toBe(code);
  });

  it("CON-URL-003 validates tokens as single-line printable text", () => {
    expect(validateToken("")).toBeNull();
    expect(validateToken("abc.DEF-123_~")).toBeNull();
    expect(validateToken("has space")?.code).toBe("INVALID_TOKEN");
    expect(validateToken("line\nbreak")?.code).toBe("INVALID_TOKEN");
  });

  it("CON-URL-004 the adapter is read-only by contract", () => {
    expect(REST_CONNECTOR.capabilities.write).toBe(false);
    expect(REST_CONNECTOR.capabilities.methods).toEqual(["GET"]);
    expect(REST_ADAPTER.capabilities).toEqual({ read: true, write: false, explicitActionRequired: true });
    expect(REST_ADAPTER.validate({ url: "http://x.example.com" }).ok).toBe(false);
  });
});

describe("CON-READ bounded read-only GET", () => {
  it("CON-READ-001 performs exactly one GET with safe options and normalizes records", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(RECORDS));
    const result = await readRestSource({ url: "https://api.example.com/customers", fetchImpl, now: () => new Date("2026-11-13T00:00:00Z") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records).toEqual(RECORDS);
    expect(result.value.format).toBe("rest-json");
    expect(result.value.adapter.id).toBe("rest-json");
    expect(result.value.label).toBe("api.example.com/customers");
    expect(result.value.provenance).toEqual({ kind: "connector", origin: "https://api.example.com", path: "/customers", byteLength: JSON.stringify(RECORDS).length, status: 200, retrievedAt: "2026-11-13T00:00:00.000Z" });
    expect(calls).toHaveLength(1);
    const init = calls[0]!.init;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.mode).toBe("cors");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("CON-READ-002 unwraps common list envelopes and says so", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ data: RECORDS, page: 1 }));
    const result = await readRestSource({ url: "https://api.example.com/c", fetchImpl });
    expect(result.ok && result.value.records).toEqual(RECORDS);
    expect(result.ok && result.value.warnings[0]?.code).toBe("ENVELOPE_UNWRAPPED");
  });

  it("CON-READ-003 sends a bearer token only as a header to the validated origin", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(RECORDS));
    const result = await readRestSource({ url: "https://api.example.com/c", token: "tok_SECRET_123", fetchImpl });
    expect(result.ok).toBe(true);
    expect(calls[0]!.url).toBe("https://api.example.com/c");
    expect(calls[0]!.url).not.toContain("tok_SECRET_123");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok_SECRET_123");
    // The token never reaches the normalized source or the engine input.
    if (result.ok) {
      expect(JSON.stringify(result.value)).not.toContain("tok_SECRET_123");
      expect(JSON.stringify(toImportedSource(result.value))).not.toContain("tok_SECRET_123");
    }
  });

  it("CON-READ-004 classifies CORS / network failures without bypassing them", async () => {
    const { fetchImpl, calls } = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const result = await readRestSource({ url: "https://api.example.com/c", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe("NETWORK_OR_CORS");
      expect(result.problem.message).toMatch(/CORS/);
    }
    expect(calls).toHaveLength(1); // never retried
  });

  it("CON-READ-005 times out", async () => {
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const result = await readRestSource({ url: "https://api.example.com/c", fetchImpl, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe("TIMEOUT");
  });

  it("CON-READ-006 refuses redirects so a token can never follow them", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example.net/" } }));
    const result = await readRestSource({ url: "https://api.example.com/c", token: "tok", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe("REDIRECT_REFUSED");
  });

  it("CON-READ-007 reports authentication failures", async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = fakeFetch(() => jsonResponse({ error: "no" }, { status }));
      const result = await readRestSource({ url: "https://api.example.com/c", fetchImpl });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem.code).toBe("AUTH_FAILED");
    }
    const { fetchImpl } = fakeFetch(() => jsonResponse({ error: "no" }, { status: 500 }));
    const failed = await readRestSource({ url: "https://api.example.com/c", fetchImpl });
    expect(!failed.ok && failed.problem.code).toBe("HTTP_ERROR");
  });

  it("CON-READ-008 refuses oversized responses by header and while streaming", async () => {
    const declared = fakeFetch(() => jsonResponse("[]", { headers: { "content-length": String(SOURCE_LIMITS.maxTextBytes + 1) } }));
    const byHeader = await readRestSource({ url: "https://api.example.com/c", fetchImpl: declared.fetchImpl });
    expect(!byHeader.ok && byHeader.problem.code).toBe("TOO_LARGE");
    const big = `[${Array.from({ length: 40_000 }, () => '{"a":"xxxxxxxxxxxxxxxxxxxx"}').join(",")}]`;
    const streamed = fakeFetch(() => jsonResponse(big));
    const byStream = await readRestSource({ url: "https://api.example.com/c", fetchImpl: streamed.fetchImpl });
    expect(!byStream.ok && byStream.problem.code).toBe("TOO_LARGE");
  });

  it("CON-READ-009 refuses non-JSON content and malformed JSON", async () => {
    const html = fakeFetch(() => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    const notJson = await readRestSource({ url: "https://api.example.com/c", fetchImpl: html.fetchImpl });
    expect(!notJson.ok && notJson.problem.code).toBe("NOT_JSON");
    const broken = fakeFetch(() => jsonResponse("{oops"));
    const malformed = await readRestSource({ url: "https://api.example.com/c", fetchImpl: broken.fetchImpl });
    expect(!malformed.ok && malformed.problem.code).toBe("NORMALIZE_FAILED");
    const scalar = fakeFetch(() => jsonResponse("42"));
    const notRecords = await readRestSource({ url: "https://api.example.com/c", fetchImpl: scalar.fetchImpl });
    expect(notRecords.ok).toBe(false);
  });

  it("CON-READ-010 invalid configuration performs no request at all", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(RECORDS));
    for (const url of ["http://api.example.com/c", "https://localhost/c", "https://api.example.com/c?token=x"]) {
      const result = await readRestSource({ url, fetchImpl });
      expect(result.ok).toBe(false);
    }
    const badToken = await readRestSource({ url: "https://api.example.com/c", token: "two words", fetchImpl });
    expect(!badToken.ok && badToken.problem.code).toBe("INVALID_TOKEN");
    expect(calls).toHaveLength(0);
  });

  it("CON-READ-011 can be cancelled by the caller", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const pending = readRestSource({ url: "https://api.example.com/c", fetchImpl, signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(!result.ok && result.problem.code).toBe("CANCELLED");
  });
});
