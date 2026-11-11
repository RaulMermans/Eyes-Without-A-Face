# Firebase CLI and MCP

Control-plane tooling for the existing project. It is read-only by default and never provisions services.

| Item | Value |
| --- | --- |
| Project ID | `eyes-without-a-face-b7281` (`.firebaserc` default alias) |
| Web app | `eyes-without-a-face-web` |
| CLI | official `firebase-tools` via `npx -y firebase-tools@latest` (verified 15.35.0, 2026-11-11) |
| MCP server | `npx -y firebase-tools@latest mcp`, registered for Claude Code in `.mcp.json` |
| Billing | Not enabled (Spark). Do not enable it. |

## Authenticate (owner, interactive)

The CLI and MCP server share the same credentials. Run once in a terminal on this machine:

```bash
npx -y firebase-tools@latest login
```

Do not create service-account keys to avoid the browser login.

## Verify read access

```bash
npx -y firebase-tools@latest login:list
npx -y firebase-tools@latest projects:list
npx -y firebase-tools@latest apps:list --project eyes-without-a-face-b7281
npx -y firebase-tools@latest apps:sdkconfig WEB --project eyes-without-a-face-b7281
npx -y firebase-tools@latest hosting:sites:list --project eyes-without-a-face-b7281
npx -y firebase-tools@latest hosting:channel:list --project eyes-without-a-face-b7281
```

Compare `apps:sdkconfig` with `.env.local` (projectId, appId, authDomain). `src/config/expected-firebase.ts` must match the same values.

## MCP

- **Claude Code:** `.mcp.json` registers one `firebase` server. Approve it when Claude Code prompts, then restart the session. Check it with `claude mcp list`.
- **Cursor:** the local, untracked `.cursor/settings.json` enables Cursor's Firebase plugin. Do not add a second registration.

The MCP server uses the CLI's credentials. Without `firebase login`, `firebase_get_environment` reports `Authenticated User: <NONE>`. A working server process is not proof of project access.

Useful read-only MCP tools: `firebase_get_environment`, `firebase_get_project`, `firebase_list_apps`, `firebase_get_sdk_config`.

Never call these without explicit owner approval: `firebase_init`, `firebase_deploy`, `firebase_create_project`, `firebase_create_app`, or any tool that writes data.

## App Check debug tokens

Neither the CLI nor the MCP server manages App Check debug tokens. Register them in the Firebase Console: App Check → Apps → `eyes-without-a-face-web` → overflow menu → Manage debug tokens. See [app-check.md](app-check.md).
