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

## AuraWorx-only directories

All listed under `aura/` subdirectories within upstream paths. **Empty at `v0.8.5-aura.1`** — populated by subsequent feature PRs (Steps 2-6 of the fork plan).

- `api/server/controllers/aura/`
- `api/server/routes/aura/`
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
