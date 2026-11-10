# Contributing

This project is a hackathon MVP. Keep changes inside the agreed boundaries: one JSON source, one destination schema, one Phantom Twin, one mapping, local verification, portable export. No backend, auth, or CRM connectors unless a later sprint explicitly adds them.

## Setup

```bash
pnpm install
pnpm dev
```

Node 22+ and pnpm 10. Copy `.env.example` to `.env.local` only when you have Firebase web config. Do not commit `.env.local` or App Check debug tokens.

## Checks

Run before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm test:privacy
pnpm build
pnpm test:e2e
```

Or `pnpm test:all`. That suite does **not** run hardware-dependent `pnpm test:live`. Do not skip failing tests or stub them empty.

## Conventions

Follow `AGENTS.md`. Domain code stays free of React and Firebase. Do not simulate successful inference. Do not execute model-generated JavaScript. Do not add `InferenceMode.PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`.
