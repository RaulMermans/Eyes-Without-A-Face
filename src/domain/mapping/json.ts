const encoder = new TextEncoder();

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function jsonByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

export function emptyObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
