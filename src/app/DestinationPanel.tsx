import { useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Disclosure, FieldToken, Panel, PanelHeader, StatusMark } from "../components/spectral.tsx";
import { assertTargetSchema } from "../domain/mapping/target-schema.ts";
import { describeTargetSchema } from "../twin/target-disclosure.ts";
import { invalidateDownstream, type WorkspaceState } from "./workspace-state.ts";

export function DestinationPanel({
  workspace,
  onChange,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
}) {
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Display-only projection, the same minimal description offered for review.
  const described = useMemo(() => {
    try {
      return describeTargetSchema(JSON.parse(workspace.destinationText) as unknown);
    } catch {
      return null;
    }
  }, [workspace.destinationText]);

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
    <Panel aria-labelledby="destination-heading">
      <PanelHeader id="destination-heading" title="Destination JSON Schema" eyebrow="Where the data must land" zone="verified" zoneText="Validated locally">
        Mapping output is validated against this schema locally. Only a minimal description of it (field names, types, required flags,
        formats, enum values) is offered for disclosure review; titles and descriptions are never sent.
      </PanelHeader>

      {described?.ok ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Destination fields" data-testid="destination-fields">
          {described.value.target.fields.map((field) => (
            <li key={field.name} className="flex items-center gap-1.5 border border-rule bg-bone px-2 py-1 text-xs">
              <FieldToken kind="destination">{field.name}</FieldToken>
              <span className="font-mono text-[11px] text-mute">
                {field.type}
                {field.format ? ` · ${field.format}` : ""}
                {field.enumValues ? ` · ${field.enumValues.join(" | ")}` : ""}
              </span>
              {field.required ? <span className="font-mono text-[10px] uppercase text-gold-ink">required</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-mute">The schema cannot be summarized until it is valid JSON Schema.</p>
      )}

      <Disclosure summary="Edit schema JSON" className="mt-4">
        <label className="block text-sm font-medium" htmlFor="destination-schema">
          Target schema
        </label>
        <textarea
          id="destination-schema"
          data-testid="destination-schema-editor"
          className="mt-1 min-h-48 w-full rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs"
          value={workspace.destinationText}
          onChange={(event) => {
            setSchemaMessage(null);
            setSchemaError(null);
            onChange(invalidateDownstream({ ...workspace, destinationText: event.target.value }));
          }}
        />
      </Disclosure>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={validate} data-testid="validate-destination-schema">
          Validate destination schema
        </Button>
        {schemaMessage ? (
          <p className="text-sm" data-testid="destination-schema-ok" role="status">
            <StatusMark status="pass">{schemaMessage}</StatusMark>
          </p>
        ) : null}
      </div>
      {schemaError ? (
        <div className="mt-3" data-testid="destination-schema-error">
          <ErrorBanner title="Destination schema is invalid">{schemaError}</ErrorBanner>
        </div>
      ) : null}
    </Panel>
  );
}
