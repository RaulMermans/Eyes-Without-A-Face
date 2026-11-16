/**
 * Sprint 18A (ADR 0016) — concept-bearing Phantom Twin.
 *
 * S18A-C-*  deterministic concept inference (expected and forbidden)
 * S18A-T-*  twin integration: descriptors, provenance, overrides
 * S18A-P-*  privacy: no field name or private value through a meaning phrase
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { profileRecords, type FieldProfile } from "../../src/domain/profile/profile.ts";
import { CONCEPTS, CONCEPT_SPECS, conceptPhrases, inferConcept, nameTokens, type Concept } from "../../src/phantom/concepts.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import { findPrivateValueLeaks } from "../../src/privacy/leak-scan.ts";
import { buildDisclosureDraft, prepareTwin } from "../../src/workflow/pipeline.ts";

const DATES = ["03/04/1981", "11/09/1975", "05/02/1990", "12/12/2001"];
const ISO = ["2021-03-04", "2022-11-09", "2023-05-02", "2024-12-12"];

function profileOf(columns: Record<string, unknown[]>): FieldProfile[] {
  const length = Math.max(...Object.values(columns).map((values) => values.length));
  const records = Array.from({ length }, (_, row) => Object.fromEntries(Object.entries(columns).map(([key, values]) => [key, values[row % values.length]])));
  const result = profileRecords(records);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("; "));
  return result.profile.fields;
}

function conceptOf(key: string, values: unknown[], siblings: Record<string, unknown[]> = {}): Concept | null {
  const fields = profileOf({ [key]: values, ...siblings });
  const field = fields.find((item) => item.path === key)!;
  return inferConcept(field, fields.map((item) => item.path).filter((path) => path !== key))?.concept ?? null;
}

function twin(records: Record<string, unknown>[], overrides: Record<string, TwinFieldOverride> = {}, concepts = true) {
  const prepared = prepareTwin({ records, datasetLabel: "s18a", seed: DEFAULT_TWIN_SEED, overrides, concepts });
  if (!prepared.ok) throw new Error(`twin failed at ${prepared.stage}: ${JSON.stringify(prepared.issues)}`);
  return prepared.value;
}

describe("S18A-C-001 tokenization", () => {
  it.each([
    ["fecha_nacimiento", ["fecha", "nacimiento"]],
    ["customerSince", ["customer", "since"]],
    ["KdNr", ["kd", "nr"]],
    ["UStIdNr", ["u", "st", "id", "nr"]],
    ["billing.zip5", ["billing", "zip", "5"]],
  ])("%s", (key, tokens) => {
    expect(nameTokens(key)).toEqual(tokens);
  });
});

describe("S18A-C-002 date meaning across languages (the DOB vs signup confusion of Sprint 16A D2)", () => {
  it.each([
    ["dob", "birth-date"],
    ["fecha_nacimiento", "birth-date"],
    ["Geburtsdatum", "birth-date"],
    ["geboortedatum", "birth-date"],
    ["date_naissance", "birth-date"],
    ["signup_date", "created-date"],
    ["fecha_alta", "created-date"],
    ["angelegt_am", "created-date"],
    ["Vertragsbeginn", "start-date"],
    ["hire_date", "start-date"],
    ["updated_at", "modified-date"],
    ["fecha_ultima_modificacion", "modified-date"],
    ["due_date", "due-date"],
    ["order_date", "transaction-date"],
  ] as const)("%s → %s", (key, concept) => {
    expect(conceptOf(key, DATES)).toBe(concept);
  });

  it("a date field with no meaning word gets no concept (no guess)", () => {
    expect(conceptOf("datum", DATES)).toBeNull();
    expect(conceptOf("fecha", ISO)).toBeNull();
  });
});

describe("S18A-C-003 identifiers: customer vs transaction", () => {
  it.each([
    ["cust_no", "customer-id"],
    ["KdNr", "customer-id"],
    ["id_cliente", "customer-id"],
    ["kundennummer", "customer-id"],
    ["order_id", "transaction-id"],
    ["RechnungsNr", "transaction-id"],
    ["num_factura", "transaction-id"],
    ["sku", "product-id"],
    ["personeelsNummer", "employee-id"],
    ["vat_number", "other-identifier"],
  ] as const)("%s → %s", (key, concept) => {
    expect(conceptOf(key, ["A-1001", "A-1002", "A-1003", "A-1004"])).toBe(concept);
  });

  it("a bare 'id' or 'code' names no entity and gets no concept", () => {
    expect(conceptOf("id", ["A-1", "A-2", "A-1"])).toBeNull();
    expect(conceptOf("code", ["X1", "X2", "X1"])).toBeNull();
  });

  it("an identifier concept is refused when the values contain spaces", () => {
    expect(conceptOf("customer_id", ["Ada Lovelace", "Alan Turing"])).toBeNull();
  });
});

describe("S18A-C-004 organization vs person names", () => {
  const PEOPLE = ["Avery Holloway", "Briar Dunmore", "Corin Ashdown"];
  it.each([
    ["company_name", "organization-name"],
    ["empresa", "organization-name"],
    ["bedrijf", "organization-name"],
    ["contact_name", "person-name"],
    ["contactpersoon", "person-name"],
    ["nombre_completo", "person-name"],
    ["full_name", "person-name"],
    ["first_name", "given-name"],
    ["apellidos", "family-name"],
  ] as const)("%s → %s", (key, concept) => {
    expect(conceptOf(key, PEOPLE)).toBe(concept);
  });

  it("a lone 'name' is ambiguous and gets no concept, unless a family-name sibling makes it the given name", () => {
    expect(conceptOf("name", PEOPLE)).toBeNull();
    expect(conceptOf("nombre", ["Ana", "Luis", "Eva"], { apellido: ["Ruiz", "Gil", "Sanz"] })).toBe("given-name");
  });
});

describe("S18A-C-005 status meaning", () => {
  const LABELS = ["open", "closed", "pending", "open"];
  it.each([
    ["account_status", "account-status"],
    ["Kontostatus", "account-status"],
    ["payment_status", "payment-status"],
    ["estado_pago", "payment-status"],
    ["order_status", "order-status"],
    ["estado_cita", "order-status"],
  ] as const)("%s → %s", (key, concept) => {
    expect(conceptOf(key, LABELS)).toBe(concept);
  });

  it("a bare 'status' says nothing about whose status it is and gets no concept", () => {
    expect(conceptOf("status", LABELS)).toBeNull();
    expect(conceptOf("estado", LABELS)).toBeNull();
  });
});

describe("S18A-C-006 observed meaning comes from values, not names", () => {
  it("category labels that are all ISO currency codes are an observed currency code, whatever the field is called", () => {
    const field = profileOf({ x1: ["eur", "usd", "eur", "gbp"] })[0]!;
    expect(inferConcept(field)).toEqual({ concept: "currency-code", qualifier: null, evidence: "value-shape", status: "observed" });
  });

  it("uppercase codes are plain strings to the profiler: only a name word makes them a (hypothetical) currency", () => {
    expect(conceptOf("x1", ["EUR", "USD", "EUR"])).toBeNull();
    expect(inferConcept(profileOf({ moneda: ["EUR", "USD", "EUR"] })[0]!)).toMatchObject({ concept: "currency-code", evidence: "field-name", status: "hypothesis" });
  });

  it("an email format is observed; a field NAMED email without email values gets no email meaning", () => {
    const result = profileRecords([
      { billing: { email: "a@example.test" }, email: "n/a" },
      { billing: { email: "b@example.test" }, email: "unknown" },
    ]);
    if (!result.ok) throw new Error("profile");
    const fields = result.profile.fields;
    expect(inferConcept(fields.find((item) => item.path === "billing.email")!)).toMatchObject({ concept: "email", qualifier: "billing", status: "observed" });
    expect(inferConcept(fields.find((item) => item.path === "email")!)).toBeNull();
  });

  it("a meaning word never overrides the observed type: 'birth_date' holding free text gets no concept", () => {
    expect(conceptOf("birth_date", ["unknown", "see notes", "n/a"])).toBeNull();
  });

  it("amounts and quantities need numeric values", () => {
    expect(conceptOf("total_amount", [12.5, 99.9, 3])).toBe("amount");
    expect(conceptOf("total_amount", ["twelve", "nine"])).toBeNull();
    expect(conceptOf("qty", [1, 2, 3])).toBe("quantity");
  });
});

describe("S18A-C-007 vocabulary invariants", () => {
  it("every concept has at least two fixed wordings, without digits or control characters", () => {
    for (const concept of CONCEPTS) {
      const phrases = CONCEPT_SPECS[concept].phrases;
      expect(phrases.length).toBeGreaterThanOrEqual(2);
      for (const phrase of phrases) expect(phrase).toMatch(/^[A-Za-z ,()/'-]+$/);
    }
  });

  it("every wording of a field-name hypothesis says it is unconfirmed", () => {
    for (const phrase of conceptPhrases({ concept: "birth-date", qualifier: null, evidence: "field-name", status: "hypothesis" })) {
      expect(phrase).toContain("[inferred, unconfirmed]");
    }
  });
});

describe("S18A-T-001 twin descriptors", () => {
  const records = [
    { dob: "1981-03-04", signup_date: "2021-03-04", cust_no: "C-1", order_id: "O-1", email: "a@example.test" },
    { dob: "1975-11-09", signup_date: "2022-11-09", cust_no: "C-2", order_id: "O-2", email: "b@example.test" },
    { dob: "1990-05-02", signup_date: "2023-05-02", cust_no: "C-1", order_id: "O-3", email: "c@example.test" },
  ];

  it("two dates of one format get different descriptors that keep the base text first", () => {
    const prepared = twin(records);
    const byPath = new Map(prepared.twin.fields.map((field) => [field.localPath, field]));
    const dob = byPath.get("dob")!.descriptor;
    const signup = byPath.get("signup_date")!.descriptor;
    expect(dob).not.toBe(signup);
    expect(dob.startsWith("Calendar date in YYYY-MM-DD format")).toBe(true);
    expect(dob).toContain("meaning: date of birth [inferred, unconfirmed]");
    expect(signup).toContain("meaning: creation or signup date [inferred, unconfirmed]");
  });

  it("concepts: false reproduces the pre-18A twin exactly (evaluation baseline T0)", () => {
    const prepared = twin(records, {}, false);
    expect(prepared.twin.fields.every((field) => field.concept === null && !field.descriptor.includes("meaning:"))).toBe(true);
    expect(prepared.twin.fields.find((field) => field.localPath === "dob")!.descriptor).toBe("Calendar date in YYYY-MM-DD format");
  });

  it("an inferred meaning is reported locally as a hypothesis, and personal data is flagged", () => {
    const dob = twin(records).twin.fields.find((field) => field.localPath === "dob")!;
    expect(dob.concept).toMatchObject({ concept: "birth-date", evidence: "field-name", status: "hypothesis" });
    expect(dob.personal).toBe(true);
    expect(twin(records).twin.limitations.some((line) => line.includes("unconfirmed hypotheses"))).toBe(true);
  });

  it("the same input always yields the same twin", () => {
    expect(JSON.stringify(twin(records).twin.phantom)).toBe(JSON.stringify(twin(records).twin.phantom));
  });
});

describe("S18A-T-002 reviewed meaning", () => {
  const records = [
    { fecha: "1981-03-04", ref: "R-1" },
    { fecha: "1975-11-09", ref: "R-2" },
  ];

  it("the data owner's concept is disclosed as confirmed", () => {
    const field = twin(records, { fecha: { concept: "birth-date" } }).twin.fields.find((item) => item.localPath === "fecha")!;
    expect(field.concept).toMatchObject({ concept: "birth-date", evidence: "user", status: "confirmed" });
    expect(field.descriptor).toContain("[confirmed]");
  });

  it("an applied on-device suggestion stays an unconfirmed hypothesis", () => {
    const field = twin(records, { fecha: { concept: "birth-date", conceptBy: "on-device-model" } }).twin.fields.find((item) => item.localPath === "fecha")!;
    expect(field.concept).toMatchObject({ evidence: "on-device-model", status: "hypothesis" });
    expect(field.descriptor).toContain("[on-device suggestion, unconfirmed]");
  });

  it("null suppresses an inferred meaning", () => {
    const field = twin([{ dob: "1981-03-04" }, { dob: "1990-05-02" }], { dob: { concept: null } }).twin.fields[0]!;
    expect(field.concept).toBeNull();
    expect(field.descriptor).not.toContain("meaning:");
  });

  it("a reviewed concept that contradicts the observed type is refused, never applied", () => {
    const result = prepareTwin({ records, datasetLabel: "s18a", seed: DEFAULT_TWIN_SEED, overrides: { fecha: { concept: "amount" } } });
    expect(result.ok).toBe(false);
    if (!result.ok && result.stage === "twin") expect(result.issues.map((issue) => issue.code)).toContain("SEMANTICS_INCOMPATIBLE");
  });

  it("a user-written descriptor is never extended with a generated meaning", () => {
    const field = twin(records, { fecha: { descriptor: "When the person was born" } }).twin.fields.find((item) => item.localPath === "fecha")!;
    expect(field.descriptor).toBe("When the person was born");
    expect(field.concept).toBeNull();
  });
});

describe("S18A-P-001 a meaning phrase never spells a field name or a private value", () => {
  it("a field called 'city' gets the alternative wording, not the word 'city'", () => {
    const prepared = twin([
      { "billing.x": 1, city: "Avalon Bay" },
      { "billing.x": 2, city: "Port Ellis" },
    ].map((record) => ({ city: record.city, n: record["billing.x"] })));
    const city = prepared.twin.fields.find((field) => field.localPath === "city")!;
    expect(city.descriptor).toContain("meaning: town or municipality");
    expect(city.descriptor.toLowerCase()).not.toContain("meaning: city");
  });

  it("a nested 'billing' parent cannot appear as a qualifier word; the alternative qualifier is used", () => {
    const prepared = twin([
      { billing: { email: "a@example.test" }, contact: { email: "x@example.test" } },
      { billing: { email: "b@example.test" }, contact: { email: "y@example.test" } },
    ]);
    const byPath = new Map(prepared.twin.fields.map((field) => [field.localPath, field.descriptor]));
    expect(byPath.get("billing.email")).toContain("(invoicing)");
    expect(byPath.get("billing.email")!.split("; ").slice(1).join(" ").toLowerCase()).not.toContain("billing");
    expect(byPath.get("billing.email")).not.toBe(byPath.get("contact.email"));
  });

  it("when every wording collides with a private value the meaning is withheld and recorded, and the twin still builds", () => {
    const prepared = twin([
      { priority: "priority level", prio_x: "urgency level", note: "a" },
      { priority: "urgency level", prio_x: "priority level", note: "b" },
    ].map((record) => ({ prio: record.priority, other: record.prio_x })));
    const prio = prepared.twin.fields.find((field) => field.localPath === "prio")!;
    expect(prio.concept).toBeNull();
    expect(prepared.twin.limitations.some((line) => line.includes("was withheld"))).toBe(true);
  });

  it("the disclosure contains no coded source key and no private value", () => {
    const records = [
      { fecha_nacimiento: "1981-03-04", id_cliente: "CL-77", nombre_completo: "Ana Ruiz Gil", estado_pago: "pagado" },
      { fecha_nacimiento: "1975-11-09", id_cliente: "CL-78", nombre_completo: "Luis Sanz Mora", estado_pago: "pendiente" },
      { fecha_nacimiento: "1990-05-02", id_cliente: "CL-79", nombre_completo: "Eva Gil Ruiz", estado_pago: "pagado" },
    ];
    const prepared = twin(records);
    const draft = buildDisclosureDraft({ prepared, targetSchema: { type: "object", properties: { birthdate: { type: "string", format: "date" } }, required: [] } });
    if (!draft.ok) throw new Error(draft.issues.join("; "));
    const text = JSON.stringify(draft.value.payload);
    for (const key of Object.keys(records[0]!)) expect(text).not.toContain(key);
    for (const value of ["CL-77", "Ana Ruiz Gil", "pagado", "pendiente"]) expect(text).not.toContain(value);
    expect(findPrivateValueLeaks(draft.value.payload, prepared.privateStrings)).toEqual([]);
  });
});

describe("S18A-P-002 a concept is never semantic evidence", () => {
  it("src/semantics and src/verification do not read concepts", () => {
    for (const file of ["src/semantics/contract.ts", "src/semantics/observe.ts", "src/semantics/verify.ts", "src/verification/outcomes.ts"]) {
      expect(fs.readFileSync(file, "utf8")).not.toMatch(/concept/i);
    }
  });
});
