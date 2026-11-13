import { SOURCE_LIMITS } from "./limits.ts";

/**
 * Archive preflight for .xlsx files, run BEFORE the workbook parser sees the
 * bytes. Reads only the ZIP central directory (no decompression) and refuses
 * archives that are malformed, ZIP64, encrypted, too many entries, too large
 * when uncompressed, or decompression-heavy. Also reports parts that EYES
 * deliberately ignores (macros, external links).
 */
export interface ArchiveEntry {
  name: string;
  compressed: number;
  uncompressed: number;
  encrypted: boolean;
}

export type PreflightResult =
  | { ok: true; entries: ArchiveEntry[]; hasMacros: boolean; hasExternalLinks: boolean }
  | { ok: false; code: "UNSAFE_ARCHIVE" | "UNSUPPORTED_FORMAT" | "ENCRYPTED"; message: string };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

function fail(code: "UNSAFE_ARCHIVE" | "UNSUPPORTED_FORMAT" | "ENCRYPTED", message: string): PreflightResult {
  return { ok: false, code, message };
}

export function preflightWorkbookArchive(bytes: Uint8Array): PreflightResult {
  if (bytes.length > SOURCE_LIMITS.maxWorkbookBytes) {
    return fail("UNSAFE_ARCHIVE", `The workbook is larger than ${SOURCE_LIMITS.maxWorkbookBytes / (1024 * 1024)} MiB. Import a smaller sample.`);
  }
  // OLE2 compound files are legacy .xls or password-protected .xlsx.
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return fail("ENCRYPTED", "This workbook is password-protected or in the legacy .xls format. Save it as an unprotected .xlsx workbook.");
  }
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return fail("UNSUPPORTED_FORMAT", "This is not an .xlsx workbook. Save it as Excel Workbook (.xlsx), or export it as CSV.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const searchStart = Math.max(0, bytes.length - (22 + 0xffff));
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return fail("UNSAFE_ARCHIVE", "The workbook archive is damaged (no central directory).");
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    return fail("UNSAFE_ARCHIVE", "ZIP64 workbooks are not supported. Import a smaller workbook.");
  }
  if (count > SOURCE_LIMITS.maxArchiveEntries) return fail("UNSAFE_ARCHIVE", `The workbook archive has more than ${SOURCE_LIMITS.maxArchiveEntries} parts.`);
  if (directoryOffset + directorySize > eocd) return fail("UNSAFE_ARCHIVE", "The workbook archive is damaged (central directory out of range).");

  const entries: ArchiveEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  let offset = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      return fail("UNSAFE_ARCHIVE", "The workbook archive is damaged (bad central directory entry).");
    }
    const flags = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) return fail("UNSAFE_ARCHIVE", "ZIP64 workbooks are not supported.");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const encrypted = (flags & 0x1) === 1;
    if (encrypted) return fail("ENCRYPTED", "This workbook is encrypted. Save it as an unprotected .xlsx workbook.");
    total += uncompressed;
    if (total > SOURCE_LIMITS.maxWorkbookUncompressedBytes) {
      return fail("UNSAFE_ARCHIVE", "The workbook expands to more data than EYES reads safely. Import a smaller sample or export it as CSV.");
    }
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > SOURCE_LIMITS.maxCompressionRatio) {
      return fail("UNSAFE_ARCHIVE", "The workbook contains a part that is unusually compressed. It was refused to protect this tab.");
    }
    entries.push({ name, compressed, uncompressed, encrypted });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!entries.some((entry) => entry.name === "xl/workbook.xml")) {
    return fail("UNSUPPORTED_FORMAT", "This archive is not an Excel workbook (.xlsx). Binary .xlsb and other formats are not supported.");
  }
  return {
    ok: true,
    entries,
    hasMacros: entries.some((entry) => /vbaProject\.bin$/i.test(entry.name)),
    hasExternalLinks: entries.some((entry) => entry.name.startsWith("xl/externalLinks/")),
  };
}
