export const WORKFLOW_STEPS = [
  {
    id: "source",
    number: 1,
    title: "Source System",
    processing: "local",
    summary: "Import a private JSON dataset on this machine. Nothing is uploaded.",
  },
  {
    id: "phantom",
    number: 2,
    title: "Phantom Twin",
    processing: "on-device",
    summary: "Interpret structure with on-device inference and approve a synthetic twin.",
  },
  {
    id: "mapping",
    number: 3,
    title: "Cloud Mapping",
    processing: "cloud",
    summary: "Ask Gemini to propose a declarative mapping against the approved twin only.",
  },
  {
    id: "verification",
    number: 4,
    title: "Verification",
    processing: "local",
    summary: "Execute the mapping locally against private test cases.",
  },
  {
    id: "export",
    number: 5,
    title: "Export",
    processing: "local",
    summary: "Package the mapping, synthetic fixtures, and verification report.",
  },
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];

export function isWorkflowStepId(value: string): value is WorkflowStepId {
  return WORKFLOW_STEPS.some((step) => step.id === value);
}
