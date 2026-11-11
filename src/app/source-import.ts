import { isPlainObject } from "../domain/mapping/json.ts";
import { PROFILE_LIMITS } from "../domain/profile/profile.ts";

export interface ImportedSource {
  label: string;
  records: Record<string, unknown>[];
}

export function parseSourceDataset(text: string, label = "imported.json"): { ok: true; value: ImportedSource } | { ok: false; message: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: "Source JSON is empty." };
  }
  if (new TextEncoder().encode(trimmed).length > PROFILE_LIMITS.maxBytes) {
    return { ok: false, message: `Source JSON exceeds ${PROFILE_LIMITS.maxBytes} bytes. Import a smaller sample.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, message: "Source JSON is malformed and could not be parsed." };
  }
  if (Array.isArray(parsed)) {
    return asRecordArray(parsed, label);
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, message: "Source JSON must be an object or an array of objects." };
  }
  if (Array.isArray(parsed.records)) {
    return asRecordArray(parsed.records, typeof parsed.datasetId === "string" ? parsed.datasetId.slice(0, 128) : label);
  }
  return asRecordArray([parsed], label);
}

function asRecordArray(
  records: unknown[],
  label: string,
): { ok: true; value: ImportedSource } | { ok: false; message: string } {
  if (records.length === 0) {
    return { ok: false, message: "Source JSON contains no records." };
  }
  if (records.length > PROFILE_LIMITS.maxRecords) {
    return { ok: false, message: `Source JSON has more than ${PROFILE_LIMITS.maxRecords} records.` };
  }
  const objects: Record<string, unknown>[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!isPlainObject(record)) {
      return { ok: false, message: `Record ${index} is not a JSON object.` };
    }
    objects.push(record);
  }
  return { ok: true, value: { label, records: objects } };
}
