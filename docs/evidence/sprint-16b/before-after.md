# Sprint 16B — before / after (local-rc-25c5eeb45f23)

BEFORE = Sprint 16A on deployed `c4a246c`. AFTER = release candidate served LOCALLY (not production evidence). Same inputs, oracle and verifier.

| Case | Before | After | Headline before → after | Export before → after | Wrong values before → after | Note |
| --- | --- | --- | --- | --- | --- | --- |
| S16A-A1 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-A1-D | FAIL | **FAIL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 72 → 72 | user clicked “Use legacy_crm_id” for customerId (explicit); headline Draft |
| S16A-A2 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-A3 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-B1 | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-B1-D | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-B2 | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-B3 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-C1 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
| S16A-C1-D | FAIL | **FAIL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 68 → 68 | user clicked “Use employee_id” for managerId (explicit); headline Draft |
| S16A-C2 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
| S16A-C3 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
| S16A-D1 | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-D1-D | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-D2 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-D3 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-E1 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
| S16A-E1-D | FAIL | **FAIL** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 42 → 42 | user clicked “Use last_scan_at” for shippedAt/deliveredAt (explicit); headline “Structure verified, with exceptions” |
| S16A-E2 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
| S16A-E3 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
| S16A-F1 | FAIL | **PASS** | Draft — not fully verified → Draft — not fully verified | blocked → DRAFT | 0 → 0 |  |
| S16A-F1-D | FAIL | **PASS** | Draft — not fully verified → Draft — not fully verified | blocked → DRAFT | 0 → 0 |  |
| S16A-F2 | FAIL | **PASS** | Ready, with exceptions → Structure verified, with exceptions | blocked → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-F3 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-G1 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-G1-D | FAIL | **FAIL** | Integration ready → Structure verified | VERIFIED → VERIFIED | 76 → 76 | user clicked “Use show_id” for ticketId (explicit); headline “Structure verified”, package VERIFIED (structural) |
| S16A-G2 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-G3 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-H1 | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-H1-D | PASS | **PASS** | Ready, with exceptions → Structure verified, with exceptions | VERIFIED_WITH_EXCEPTIONS → VERIFIED_WITH_EXCEPTIONS | 0 → 0 |  |
| S16A-H2 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-H3 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-R01 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-R02 | FAIL | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 22 → 0 |  |
| S16A-R03 | UNSUPPORTED | **UNSUPPORTED** | — → — | — → — | — → — |  |
| S16A-X01 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X02 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X03 | UNSUPPORTED | **UNSUPPORTED** | — → — | — → — | — → — | S16A-L5 single record cannot fill a category field |
| S16A-X04 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X05 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X06 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X07 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X08 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X09 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X10 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X11 | PASS | **PASS** | — → — | — → — | — → — |  |
| S16A-X12 | FAIL | **UNSUPPORTED** | — → — | — → — | — → — | S16A-D4 contained: the 4 unusable columns are listed with the naming rule; bracketed paths are post-hackathon |
| S16A-X13 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X14 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X15 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X16 | UNSUPPORTED | **UNSUPPORTED** | — → — | — → — | — → — | S16A-L4 depth > 4 refuses the source, with a message |
| S16A-X17 | FAIL | **UNSUPPORTED** | Integration ready → — | VERIFIED → — | 20 → — | true id column excluded (mixed types) and now LISTED with the reason; nothing else is used in its place; number→text conversion is not in the DSL |
| S16A-X18 | UNSUPPORTED | **UNSUPPORTED** | — → — | — → — | — → — | S16A-L2 one dirty value disables the date column (still not explained on screen) |
| S16A-X19 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X20 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X21 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-X22 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X23 | UNSUPPORTED | **UNSUPPORTED** | — → — | — → — | — → — | S16A-L3 locale numbers/dates |
| S16A-X24 | UNSUPPORTED | **UNSUPPORTED** | — → — | — → — | — → — | S16A-L3 two-decimal text amounts |
| S16A-X25 | PASS | **PASS** | Integration ready → Structure verified | VERIFIED → VERIFIED | 0 → 0 |  |
| S16A-X26 | PASS | **PASS** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 |  |
| S16A-X27 | PARTIAL | **PARTIAL** | Draft — not fully verified → Draft — not fully verified | DRAFT → DRAFT | 0 → 0 | S16A-L1 |
