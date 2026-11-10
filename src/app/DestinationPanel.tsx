import { useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { assertTargetSchema } from "../domain/mapping/target-schema.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export function DestinationPanel({
  workspace,
  onChange,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
}) {
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  function validate(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(workspace.destinationText) as unknown;
    } catch {
      setSchemaMessage(null);
      setSchemaError("Destination schema is not valid JSON.");
      return;
    }
    const result = assertTargetSchema(parsed);
    if (!result.ok) {
      setSchemaMessage(null);
      setSchemaError(result.issues.map((issue) => issue.message).join("; "));
      return;
    }
    setSchemaError(null);
    const title = (parsed as { title?: unknown }).title;
    setSchemaMessage(
      typeof title === "string" ? `Destination schema is valid JSON Schema 2020-12 (${title}).` : "Destination schema is valid JSON Schema 2020-12.",
    );
  }

  return (
    <section aria-labelledby="destination-heading" className="border border-rule bg-panel p-5">
      <h3 id="destination-heading" className="text-base font-semibold">
        Destination JSON Schema
      </h3>
      <p className="mt-2 text-sm leading-6 text-mute">
        Mapping output is validated against this schema locally. Phantom Twin generation from
        private structure is not part of this sprint.
      </p>
      <label className="mt-4 block text-sm font-medium" htmlFor="destination-schema">
        Target schema
      </label>
      <textarea
        id="destination-schema"
        data-testid="destination-schema-editor"
        className="mt-1 min-h-48 w-full border border-rule bg-paper p-3 font-mono text-xs"
        value={workspace.destinationText}
        onChange={(event) => {
          setSchemaMessage(null);
          setSchemaError(null);
          onChange({ ...workspace, destinationText: event.target.value, batch: null });
        }}
      />
      <div className="mt-3">
        <Button onClick={validate} data-testid="validate-destination-schema">
          Validate destination schema
        </Button>
      </div>
      {schemaMessage ? (
        <p className="mt-3 text-sm text-local" data-testid="destination-schema-ok">
          {schemaMessage}
        </p>
      ) : null}
      {schemaError ? (
        <div className="mt-3" data-testid="destination-schema-error">
          <ErrorBanner title="Destination schema is invalid">{schemaError}</ErrorBanner>
        </div>
      ) : null}
    </section>
  );
}
