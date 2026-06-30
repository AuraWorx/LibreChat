# AuraWorx Fork — Change Log

This file is the conflict-resolution checklist for `upstream-sync` PRs.
Every upstream file we touch is listed here with the reason.

The machine-readable source of truth for the boundary contract is
`.github/fork-boundary.yml`. This file is for human review.

## Modified upstream files

### `api/server/controllers/TwoFactorController.js`

- **Reason:** DocumentDB 5.0 incompatibility with Mongoose mixed projections during 2FA enrollment (AuraWorx/librechat-suite#259)
- **Mechanism:** Full file replacement — narrows 5 projection strings to only `+select:false` overrides
- **Upstream PR:** Not yet filed (planned post exit-gate)
- **Conflict risk on upstream sync:** Low (file rarely changes upstream)

### `packages/data-provider/src/bedrock.ts`

- **Reason:** Bedrock topK / Claude 4 adaptive-thinking validation error (AuraWorx/librechat-suite#269)
- **Mechanism:** Source-level fix to `bedrockInputParser` — drops `topK` from forwarded `additionalModelRequestFields` entirely (Bedrock rejects camelCase `topK`, and Claude 4 adaptive thinking rejects snake_case `top_k` too)
- **Upstream PR:** Not yet filed (planned post exit-gate)
- **Conflict risk on upstream sync:** Medium (bedrock parsers see active upstream development)

### `api/server/routes/index.js`

- **Reason:** Entry-point export for AuraWorx routers (`bedrockKeys`, `bedrockProxy`) — Bedrock API Keys feature (AuraWorx/librechat-suite#276)
- **Mechanism:** Two require lines + two export entries only; no logic
- **Conflict risk on upstream sync:** Low (upstream rarely adds new routers here)

### `api/server/index.js`

- **Reason:** Mounts `/api/bedrock-keys` and `/bedrock` routers — Bedrock API Keys feature (AuraWorx/librechat-suite#276)
- **Mechanism:** Two `app.use()` lines only
- **Conflict risk on upstream sync:** Medium (upstream occasionally adds new mounts here)

## AuraWorx-only directories

All listed under `aura/` subdirectories within upstream paths.

- `api/server/controllers/aura/`
- `api/server/routes/aura/`
- `api/server/middleware/aura/`   ← added for Bedrock API Keys (Steps 2-3, #276)
- `api/server/services/aura/`     ← added for Bedrock API Keys (Steps 2-3, #276)
- `api/models/aura/`
- `client/src/components/aura/`
- `client/src/hooks/aura/`

## Tag naming convention

Tags follow the pattern `vX.Y.Z-aura.N`:
- `vX.Y.Z` = exact upstream baseline (e.g., `v0.8.5`)
- `aura.N` = AuraWorx release number on that baseline (monotonic per baseline)

Pushing a `v*-aura.*` tag triggers `.github/workflows/build-and-push.yml` which publishes `ghcr.io/auraworx/librechat:<tag>`.

## Upstream sync

`.github/workflows/upstream-sync.yml` runs every Monday at 09:00 UTC, fetches the latest upstream tag, and opens a PR. Clean merges are labelled `auto-merge-candidate`; conflict merges are labelled `needs-manual-resolution`.

For conflict-resolution PRs, this `FORK_CHANGES.md` is the expected-conflict checklist — every file listed above is a likely conflict point.
