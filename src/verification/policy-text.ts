/**
 * Sprint 16B (D3): the guided flow's set-aside policy description, shared by
 * the policy builder (src/app/guided/field-plan.ts) and the export scan, which
 * recognises it as application-owned text. Kept outside the frozen
 * src/verification/outcomes.ts (Sprint 8 benchmark freeze).
 */
export const GUIDED_SET_ASIDE_DESCRIPTION = "Strict, except records whose category the user set aside, or that has no translation, are held for manual review (never counted as transformed).";
