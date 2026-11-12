import { validateContract } from "../domain/validation/validate-contract.ts";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { useState } from "react";
import type { WorkspaceState } from "./workspace-state.ts";

const UNSUPPORTED_SAMPLE = `{
  "contractKind": "mapping",
  "schemaVersion": "1.0.0",
  "mappingId": "unsupported",
  "mappingVersion": "1",
  "phantomId": "phantom-crm-accounts-v1",
  "destinationSchemaId": "helpdesk-account",
  "operations": [
    { "op": "eval_js", "from": "customer_id", "to": "id" }
  ]
}`;

export function MappingPanel({
  workspace,
  onChange,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function validate(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(workspace.mappingText) as unknown;
    } catch {
      setMessage(null);
      setError("Mapping contract is not valid JSON.");
      return;
    }
    const result = validateContract(parsed);
    if (!result.valid) {
      setMessage(null);
      setError(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      return;
    }
    setError(null);
    setMessage("Mapping contract is a valid declarative contract. It is not executed until the Reality Check.");
  }

  return (
    <section aria-labelledby="mapping-editor-heading">
      <h3 id="mapping-editor-heading" className="text-base font-semibold">
        Declarative mapping contract
      </h3>
      <p className="mt-2 text-sm leading-6 text-mute">
        A hand-written contract over the local source field names. It never leaves this browser
        and is not AI output. Operations are copy, rename, trim, normalize_email, parse_date,
        map_enum, default_if_missing, and concat. Executable JavaScript is rejected.
      </p>
      <label className="mt-4 block text-sm font-medium" htmlFor="mapping-json">
        Mapping JSON
      </label>
      <textarea
        id="mapping-json"
        data-testid="mapping-json-editor"
        className="mt-1 min-h-56 w-full rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs"
        value={workspace.mappingText}
        onChange={(event) => {
          setMessage(null);
          setError(null);
          onChange({ ...workspace, mappingText: event.target.value, report: null });
        }}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={validate} data-testid="validate-mapping-contract">
          Validate mapping contract
        </Button>
        <Button
          onClick={() => {
            setMessage(null);
            setError(null);
            onChange({ ...workspace, mappingText: UNSUPPORTED_SAMPLE, mappingChoice: "manual", report: null });
          }}
          data-testid="load-unsupported-mapping"
        >
          Load unsupported operation
        </Button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-pass" data-testid="mapping-contract-ok">
          {message}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3" data-testid="mapping-contract-error">
          <ErrorBanner title="Mapping contract is invalid">{error}</ErrorBanner>
        </div>
      ) : null}
    </section>
  );
}
