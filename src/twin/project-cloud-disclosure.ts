import type {
  CloudDisclosureDestination,
  CloudDisclosurePayload,
  CloudDisclosureTarget,
  PhantomContract,
} from "../domain/contracts/types.ts";
import { CURRENT_CONTRACT_SCHEMA_VERSION } from "../domain/contracts/kinds.ts";

const DEFAULT_DESTINATION: CloudDisclosureDestination = {
  provider: "firebase-ai-logic",
  backend: "google-ai",
  model: "gemini-3.5-flash-lite",
  purpose: "mapping-proposal",
};

/**
 * Explicit allowlist projection. Does not clone the Phantom Contract and strip keys.
 */
export const MAX_DISCLOSED_EXAMPLES = 8;

export function projectCloudDisclosurePayload(
  phantom: PhantomContract,
  destination: CloudDisclosureDestination = DEFAULT_DESTINATION,
  target?: CloudDisclosureTarget,
): CloudDisclosurePayload {
  const shareableAliases = new Set(
    phantom.fields.filter((field) => field.shareable).map((field) => field.alias),
  );

  const fields = phantom.fields
    .filter((field) => field.shareable)
    .map((field) => {
      const projected: CloudDisclosurePayload["fields"][number] = {
        alias: field.alias,
        entityId: field.entityId,
        type: field.type,
        semanticDescriptor: field.semanticDescriptor,
      };
      if (field.enumValues) {
        projected.enumValues = [...field.enumValues];
      }
      return projected;
    });

  const entities = phantom.entities.map((entity) => {
    const projected: CloudDisclosurePayload["entities"][number] = {
      id: entity.id,
      label: entity.label,
    };
    if (entity.description) {
      projected.description = entity.description.slice(0, 280);
    }
    return projected;
  });

  const syntheticExamples = phantom.syntheticExamples.slice(0, MAX_DISCLOSED_EXAMPLES).map((example) => {
    const row: Record<string, string | number | boolean | null> = {};
    for (const alias of shareableAliases) {
      if (Object.prototype.hasOwnProperty.call(example, alias)) {
        const value = example[alias];
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          row[alias] = value;
        }
      }
    }
    return row;
  });

  const payload: CloudDisclosurePayload = {
    contractKind: "cloud-disclosure",
    schemaVersion: CURRENT_CONTRACT_SCHEMA_VERSION,
    payloadId: `disclosure-${phantom.phantomId}`,
    phantomId: phantom.phantomId,
    destination: {
      provider: destination.provider,
      backend: destination.backend,
      model: destination.model,
      purpose: destination.purpose,
    },
    purpose: "mapping-proposal",
    entities,
    fields,
    syntheticExamples,
  };

  if (target) {
    // Schema 1.1.0: explicit field-by-field copy of the reviewed target description.
    payload.schemaVersion = "1.1.0";
    payload.target = {
      fields: target.fields.map((field) => {
        const projected: CloudDisclosureTarget["fields"][number] = {
          name: field.name,
          type: field.type,
          required: field.required,
        };
        if (field.nullable) projected.nullable = true;
        if (field.format) projected.format = field.format;
        if (field.enumValues) projected.enumValues = [...field.enumValues];
        return projected;
      }),
    };
  }

  if (phantom.disclosureConstraints && phantom.disclosureConstraints.length > 0) {
    payload.disclosureConstraints = phantom.disclosureConstraints
      .slice(0, 12)
      .map((item) => item.slice(0, 280));
  }

  return payload;
}

export function defaultCloudDestination(): CloudDisclosureDestination {
  return { ...DEFAULT_DESTINATION };
}
