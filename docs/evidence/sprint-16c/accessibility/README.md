# Sprint 16C — accessibility and cross-browser

| Check | Kind | Result | Evidence |
| --- | --- | --- | --- |
| Manual screen-reader pass (Orca / NVDA / VoiceOver, with a person) | HUMAN_OBSERVED | **NOT RUN** | protocol below |
| Full Scenario 2 workflow, Chromium | LOCAL, automated | PASS (30 transformed, 0 model requests, 0 page errors) | [automated-local.json](automated-local.json) |
| Full Scenario 2 workflow, Firefox | LOCAL, automated | PASS | same |
| 390 px viewport, data → destination → result | LOCAL, automated | PASS (0 px horizontal overflow, Chromium + Firefox) | same |
| 200% zoom (1280 px window = 640 CSS px) | LOCAL, automated | PASS (0 px overflow; build and download reachable) | same |
| Keyboard only | LOCAL, automated | PASS: Tab reaches category radio → Space selects → translation → field-match select → “Use …” → build (Enter) → download; focus visible on each | same |
| Reduced motion (`prefers-reduced-motion: reduce`) | LOCAL, automated | PASS (0 running infinite animations) | same |
| Announcements | LOCAL, automated | PASS: build blocker and import problem are `role="alert"` | same |
| The same checks on production | PRODUCTION_DETERMINISTIC | **NOT RUN**, pending the approved deployment | `pnpm exec playwright test -c playwright.qa-16c.config.ts` |

Automated checks prove reachability, layout and roles. They do **not** prove that a screen reader announces things understandably, and they are not a screen-reader pass.

## Manual screen-reader protocol (NOT RUN)

**Setup:** Orca on Linux with Firefox or Chrome (or NVDA + Firefox on Windows, or VoiceOver + Safari/Chrome on macOS), on the deployed SHA. Use the keyboard only; the monitor may be off. Use the Scenario 2 participant pack.

| # | Step | Pass when the screen reader… |
| --- | --- | --- |
| 1 | Land on the page | announces the page title and the step heading (“Step 1 of 3 … Where is your data?”) |
| 2 | Choose the CSV file | announces the file control by name; after loading, the records / fields summary and any excluded-fields list are reachable |
| 3 | Apply the destination schema | the “Your own” option, the schema text area and “Use this schema” have names; an invalid schema's problem is announced |
| 4 | Category question | the fieldset legend (“Source of deliveryState”), each radio with its field name, and “Translate them here” |
| 5 | Category translation | each select is announced as “<value> becomes”, with its current choice; progress (“3 of 8 decided”) is reachable |
| 6 | Field matches | each select is announced as “Source of <field>”, with “Not decided” / “No field” / the field; the “Suggested: … a suggestion, not proof of meaning” text and the “Use …” button are announced |
| 7 | Build blocked | the blocker (`role="alert"`) is announced without moving focus |
| 8 | Build on this device | the result headline (“Structure verified” …), the counts and the “Meaning, field by field” lines are reachable in order |
| 9 | Status changes | “Checked again: meaning is now verified…” (`role="status"`) is announced after a translation change on the Result |
| 10 | Privacy | the data screen's “in this browser only” statement; on the Gemini path, the approval card, the request preview and the Approve / Reject buttons |
| 11 | Downloads | “Download transformed data (JSON)”, the CSV link, the package-labels checkbox, “Download integration (.zip)” and “Download bindings.local.json” are reachable and named |
| 12 | Focus | focus never lands on hidden content and never gets lost after Build or after a download |

Record blockers (a step that cannot be completed) separately from warnings. Store no recordings in the repository.
