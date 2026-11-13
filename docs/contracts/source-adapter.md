# Source Adapter contract 1.0.0 (Sprint 13)

Code: `src/sources/`. Decision: [ADR 0012](../decisions/0012-guided-flow-and-source-adapters.md).

Every input becomes one `NormalizedSource`. The engine then reads only `records` and `label`, through `toImportedSource` → `ImportedSource`.

## NormalizedSource

| Field | Meaning |
| --- | --- |
| `adapter` | `{ id: "json-file" \| "csv-file" \| "xlsx-file" \| "rest-json", version: "1.0.0" }` |
| `format` | `json`, `csv`, `xlsx`, `rest-json` |
| `label` | File name, `file · sheet`, the JSON `datasetId`, or `host/path` |
| `records` | Plain objects. **Private.** Never logged, persisted, disclosed or exported. |
| `fields` | Name, presence count, value kinds. Local only. |
| `provenance` | `file` (name, bytes, sheet, sheet names), `connector` (origin, path without query, bytes, HTTP status, time) or `demo`. Never values; never a token. |
| `warnings` | Codes such as `EMPTY_CELLS_MISSING`, `DATES_CONVERTED`, `FORMULA_WITHOUT_VALUE`, `MIXED_TYPES`, `TEXT_KEPT`, `MACROS_IGNORED`. `attention` severity is shown on the data screen; `info` is in "How the data was read". |
| `typeCandidates` | Text columns that could become numbers or booleans **losslessly**. Applied only by the user's explicit choice. |
| `textKept` | Columns kept as text on purpose (`leading-zeros`, `precision`, `date-like`) |

A blocking `SourceProblem` is one actionable sentence with a code. It names row numbers, column letters and column names, never cell values.

## Adapter interface (`src/sources/adapter.ts`)

```ts
interface SourceAdapter<Config, Result> {
  id: string;
  label: string;
  capabilities: { read: true; write: false; explicitActionRequired: true };
  validate(config): { ok: true } | { ok: false; message: string }; // pure, no I/O
  read(config, signal?): Promise<Result>;                          // one bounded read, user-initiated
  dispose(): void;
}
```

## Normalization rules

- **Header:** the first non-empty row. Names are trimmed and must be unique, non-empty and at most 64 characters.
- **Empty values:** an empty cell is a *missing* field, exactly like a JSON record without the key. Fully empty rows are skipped and counted.
- **CSV:** comma-delimited, UTF-8 (BOM removed), RFC 4180 quoting including `""` and multi-line values. Every row must have the header's width; otherwise nothing loads and the problem lists the rows. Semicolon or tab files are refused with an export hint.
- **No silent coercion:** CSV values stay text. Leading zeros, long IDs, `1.50` and ambiguous dates are preserved.
- **XLSX:** text, numbers and booleans keep their types. Date-formatted numbers become ISO 8601 text from the workbook's date system (time-zone independent). Formulas contribute their cached result, which is reported. A formula without a cached result, and error cells, become missing and are reported. Hidden sheets are flagged. Other sheets can be selected.
- **REST:** the same shapes as a JSON file, plus `{ data | items | results: [...] }` envelopes (reported).

## Limits (`src/sources/limits.ts`)

| Bound | Value |
| --- | --- |
| JSON / CSV / response text | 1 MiB |
| XLSX file | 2 MiB compressed |
| XLSX archive | ≤ 400 parts, ≤ 24 MiB uncompressed in total, compression ratio ≤ 120 for any part > 1 MiB, no ZIP64, no encryption |
| Records | 250 (the profiler's limit) |
| Columns | 64 |
| Cells | 16,000 |
| Cell text | 10,000 characters |
| REST timeout | 10 s |

## REST connector safety (`src/sources/rest.ts`)

| Allowed | Refused |
| --- | --- |
| HTTPS on the default port, a public DNS host | `http:`, IP literals, `localhost`, single-label hosts, `.local` / `.internal` / `.lan` / … |
| One `GET`, no body, `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"` | Any other method; user:password in the URL; credential-like query keys (`token`, `api_key`, …) |
| Optional bearer token, sent only in the `Authorization` header to the confirmed origin | Redirects (`redirect: "manual"`, refused), so a token cannot follow one |
| `application/json` or `+json` responses, strict `JSON.parse`, size enforced while streaming | Non-JSON content types, oversized bodies, malformed JSON |

- CORS is the browser's. There is no proxy and no bypass; a refusal is reported as `NETWORK_OR_CORS`.
- The token exists only in the connect form's component state until the read finishes, and is then cleared. It is never part of `NormalizedSource`, the workspace, telemetry, a disclosure or an export.
- There are no automatic or repeated requests: typing an address performs no I/O.

**Residual risks.** A browser cannot prevent DNS rebinding of a public name to a private address; Chrome's Private Network Access checks apply. A hostile `.xlsx` whose central directory under-states sizes passes the preflight. It is then bounded only by the 2 MiB input and the parser, and the worst case is the user's own tab.

## Future connectors (not implemented)

| Source | Shape |
| --- | --- |
| Google Sheets | REST with OAuth (Google Identity Services, read-only scope, token in memory); same adapter contract. |
| PostgreSQL / MySQL | Browsers cannot open database sockets. This needs a locally run or self-hosted read-only connector service that exposes a bounded JSON endpoint; EYES then uses the REST adapter. |
| HubSpot / Salesforce | Their APIs need OAuth and generally do not allow browser CORS, so they need the same controlled connector service. |
| Additional REST APIs | Already supported when CORS-enabled. |

Any **write** to a source or destination needs a separately designed permission and approval model. It is out of scope.
