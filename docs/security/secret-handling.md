# Secret handling

| Item | Classification | Handling |
| --- | --- | --- |
| Firebase apiKey, appId, projectId | Public web identifiers | Allowed in `VITE_*` / `.env.example` placeholders |
| App Check debug token | Secret | Local only. Never `VITE_*`. Never commit |
| Service account JSON | Secret | Not used in the MVP. Do not add |
| Gemini API keys outside Firebase | Secret | Not used. Do not add a second provider fallback |

`.env.example` contains empty placeholders only. `.env` and `.env.local` are gitignored. Production App Check uses reCAPTCHA Enterprise, not the debug provider. The reCAPTCHA site key is public; the debug token is not.
