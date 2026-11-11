import { canonicalizeJson } from "../domain/json/canonical.ts";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export async function fingerprintCanonicalPayload(payload: unknown): Promise<{
  canonicalJson: string;
  payloadHash: string;
}> {
  const canonicalJson = canonicalizeJson(payload);
  const payloadHash = await sha256Hex(utf8Bytes(canonicalJson));
  return { canonicalJson, payloadHash };
}
