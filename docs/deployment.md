# Deployment status

**Sprint 4 has not deployed anything.** The CLI (verified 2026-11-11) shows the `live` channel already holds a release from **2026-11-10 18:20** at https://eyes-without-a-face-b7281.web.app. That release predates Sprint 4, and its content and Git revision were not recorded. Treat it as unknown until it is redeployed from a known commit. Deploy only with explicit owner approval.

| Item | Value |
| --- | --- |
| Firebase project | `eyes-without-a-face-b7281` |
| Hosting site ID | `eyes-without-a-face-b7281` (confirmed with `hosting:sites:list`) |
| Live / preview channels | `live` only (last release 2026-11-10 18:20, revision unknown). No preview channels |
| Build command | `pnpm build` (`tsc -b && vite build`) |
| Output directory | `dist/` (gitignored) |
| Hosting config | `firebase.json`: `public: dist`, SPA rewrite `** → /index.html` |
| Runtime | Static client-only SPA. No Functions, Firestore, or backend. |
| Inference | Firebase AI Logic in the browser, Gemini Developer API, App Check with reCAPTCHA Enterprise. |

## Runtime assumptions for a hosted build

- Production builds refuse `VITE_APP_CHECK_DEBUG=true`, so a hosted build needs the reCAPTCHA Enterprise site key. The Hosting domain must also be allowed for that key.
- `VITE_*` values are compiled into the bundle. They hold public web identifiers only.
- On-device inference runs in the visitor's own Chrome. Hosting does not change on-device eligibility.

## Preview deploy (owner-approved only)

```bash
pnpm build
npx -y firebase-tools@latest hosting:channel:deploy demo --expires 7d --project eyes-without-a-face-b7281
```

A preview channel leaves the live site untouched. Record the Git revision (`git rev-parse HEAD`) next to any deployed URL.
