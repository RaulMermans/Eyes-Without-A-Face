export const WORKFLOW_STEPS = [
  {
    id: "source",
    number: 1,
    title: "Source System",
    processing: "local",
    summary: "Import a private JSON dataset and profile its structure on this machine. Nothing is uploaded.",
  },
  {
    id: "phantom",
    number: 2,
    title: "Phantom Twin",
    processing: "local · on-device AI",
    summary: "Generate a fictional twin: synthetic aliases and examples that stand in for the private fields.",
  },
  {
    id: "review",
    number: 3,
    title: "Disclosure Review",
    processing: "approval",
    summary: "Read the exact prompt the application would send to Gemini, then approve or reject it.",
  },
  {
    id: "mapping",
    number: 4,
    title: "Cloud Mapping",
    processing: "cloud",
    summary: "Send the approved request. Gemini proposes declarative operations against aliases only.",
  },
  {
    id: "verification",
    number: 5,
    title: "Reality Check",
    processing: "local",
    summary: "Resolve aliases locally and run the mapping against the private records and reserved hidden cases.",
  },
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];

export function isWorkflowStepId(value: string): value is WorkflowStepId {
  return WORKFLOW_STEPS.some((step) => step.id === value);
}
