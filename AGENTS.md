# AGENTS.md — AuraWorx LibreChat fork

> First-read for Claude Code, OpenAI Codex, GitHub Copilot CLI, and any other LLM-driven agent working in this repository. CLAUDE.md (if present) layers on top of this; this file is the boundary contract.

## What this repo is

This is **AuraWorx's fork of `danny-avila/LibreChat`**, tracking upstream releases and adding a minimum of AuraWorx-specific patches. The image built from this repo is published to `ghcr.io/auraworx/librechat:<tag>` and consumed by `AuraWorx/librechat-suite` via a single line in `librechat-cdk/config/config.json`.

**The fork's single purpose: stay upstream-mergeable while shipping AuraWorx-required behavior changes.** Every commit either pulls upstream, or adds an AuraWorx patch that's isolated enough to survive future upstream merges.

## The boundary contract — read before any edit

Everything in this repo is one of three things:

1. **Upstream-owned files.** The vast majority of the tree. Do **not** edit these. They're maintained by the danny-avila/LibreChat project. Edits here cause merge pain on every upstream sync.
2. **AuraWorx-owned directories** (`aura/`, when present). Net-new code we add. Edit freely.
3. **Allowed entry-point files.** A small explicit allowlist in `.github/fork-boundary.yml` of upstream files we're permitted to surgically edit (e.g., a one-line require/import that hooks our `aura/` code into upstream's bootstrap). Edits here are capped at **10 added lines per file**, mechanically enforced by `.github/workflows/fork-boundary-check.yml`.

If you need behavior change that doesn't fit category 2 or 3, **propose moving the logic into an `aura/` directory** rather than editing an upstream file. The boundary check will fail your PR otherwise.

The contract itself lives in `.github/fork-boundary.yml`. Expanding the allowlist is a separate PR with written justification.

## Tag discipline

Tags follow `v<upstream-baseline>-aura.<N>` — e.g., `v0.8.5-aura.1` (first AuraWorx patch on upstream `v0.8.5`), `v0.8.5-aura.2`, etc.

- **`*-aura.1` is the first build on a new upstream baseline.** GHCR defaults new packages to private; a tag push to a non-existent package may not auto-publish. `.github/workflows/build-and-push.yml` annotates a `::warning::` on `-aura.1` pushes reminding you to dispatch the workflow manually if no image appears.
- **`*-aura.N` (N ≥ 2)** publishes via the normal tag-push path.
- After any publish, `.github/workflows/verify-ghcr-visibility.yml` probes the registry anonymously and opens a sticky issue if the image isn't pullable (typical cause: package still set to private).

## Upstream sync rule

When pulling a new upstream release:

1. Fetch upstream `main`, merge or rebase into the fork branch.
2. Resolve conflicts in **upstream files**. Conflicts inside `aura/` should be rare; they signal the boundary contract was breached.
3. Re-tag as `vX.Y.Z-aura.1` once the upstream baseline is the new `vX.Y.Z`.
4. Run `.github/workflows/build-and-push.yml`; expect the baseline warning.
5. Verify the image pulls anonymously (the visibility workflow will tell you).

## Related docs (in the librechat-suite repo)

These live in the consumer repo, not here, but every fork-touching change should reference them:

- `docs/librechat-fork-handbook.md` — narrative overview of the two-repo model
- `docs/librechat-fork-sops.md` — do/don'ts, rotation deadlines, incident playbook
- `docs/fork/guardrails-and-enforcement.md` — the 17-guardrail design + enforcement mechanisms
- `docs/fork/librechat-fork-architecture.html` — 8 hand-authored SVG diagrams

## Where Claude/agent CLAUDE.md guidance applies

`CLAUDE.md` (referenced as a single-line pointer at the top of this repo) is the agent-specific layer. Read it after this file. If anything in CLAUDE.md conflicts with this AGENTS.md, **AGENTS.md wins** — the boundary contract is the load-bearing rule.

## On turn 1 in this repo, an agent should be able to

- Name the upstream project this is forked from.
- State the three categories of files (upstream / aura / allowlist).
- Quote the 10-line rule and where it's enforced.
- Name the tag pattern.
- Point to `.github/fork-boundary.yml` as the source of truth for the allowlist.

If you can't do those, re-read this file before touching anything.
