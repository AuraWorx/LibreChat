# LibreChat — AuraWorx fork

> **Read `AGENTS.md` first.** It is the fork's boundary contract and **wins any conflict with this file**. In short: this is AuraWorx's fork of `danny-avila/LibreChat`; the vast majority of the tree is upstream-owned and must not be edited. New feature code goes in `aura/` subdirectories; the only upstream files you may touch are the explicit allowlist in `.github/fork-boundary.yml` (capped at 10 added lines each, CI-enforced).
>
> This file is the **coding-style layer** — the conventions to follow when you write new code (in `aura/`) or make a justified, allowlisted surgical edit to an upstream file.

## Project Overview

LibreChat is a monorepo with these key workspaces:

| Workspace | Language | Side | Dependency | Purpose |
|---|---|---|---|---|
| `/api` | JS (legacy) | Backend | `packages/api`, `packages/data-schemas`, `packages/data-provider`, `@librechat/agents` | Express server — minimize changes here |
| `/packages/api` | **TypeScript** | Backend | `packages/data-schemas`, `packages/data-provider` | New backend code lives here (TS only, consumed by `/api`) |
| `/packages/data-schemas` | TypeScript | Backend | `packages/data-provider` | Database models/schemas, shareable across backend projects |
| `/packages/data-provider` | TypeScript | Shared | — | Shared API types, endpoints, data-service — used by both frontend and backend |
| `/client` | TypeScript/React | Frontend | `packages/data-provider`, `packages/client` | Frontend SPA |
| `/packages/client` | TypeScript | Frontend | `packages/data-provider` | Shared frontend utilities |

`@librechat/agents` (a major backend dependency from the same upstream team) is consumed as an npm package under `node_modules/@librechat/agents`.

---

## Workspace Boundaries

Per the boundary contract, prefer **net-new code in `aura/` subdirectories** (`api/server/controllers/aura/`, `api/server/routes/aura/`, `api/models/aura/`, `client/src/components/aura/`, `client/src/hooks/aura/`). The map below describes where each *kind* of code belongs upstream — apply it when authoring an `aura/` module or an allowlisted edit:

- **All new backend code must be TypeScript** — mirror `/packages/api`, not the legacy JS in `/api`.
- Keep any `/api` change to the absolute minimum (thin JS wrapper calling into TS).
- Database-specific shared logic mirrors `/packages/data-schemas`.
- Frontend/backend shared API logic (endpoints, types, data-service) mirrors `/packages/data-provider`.
- Build data-provider from project root: `npm run build:data-provider`.

---

## Code Style

### Naming and File Organization

- **Single-word file names** whenever possible (e.g., `permissions.ts`, `capabilities.ts`, `service.ts`).
- When multiple words are needed, group related modules under a **single-word directory** rather than multi-word file names — `admin/capabilities.ts`, not `adminCapabilities.ts`. The directory provides the context: `app/service.ts`, not `app/appConfigService.ts`.

### Structure and Clarity

- **Never-nesting**: early returns, flat code, minimal indentation. Break complex operations into well-named helpers.
- **Functional first**: pure functions, immutable data, `map`/`filter`/`reduce` over imperative loops. Reach for OOP only when it clearly improves domain modeling or state encapsulation.
- **No dynamic imports** unless absolutely necessary.

### DRY

- Extract repeated logic into utility functions; parameterize instead of near-duplicating.
- Reusable hooks / HOCs for UI patterns; constants for repeated values; config objects over duplicated init.
- Shared validators, centralized error handling, single source of truth for business rules.
- Shared typing system with interfaces/types extending common base definitions.
- Abstraction layers for external API interactions.

### Iteration and Performance

- **Minimize looping** — message arrays and other shared structures are iterated constantly; every extra pass adds up at scale. Consolidate sequential O(n) work into a single pass; never loop the same collection twice when the work can combine.
- Choose data structures that reduce iteration (`Map`/`Set` lookups over `Array.find`/`Array.includes`).
- Avoid unnecessary object creation; mind space-time tradeoffs. Prevent memory leaks (closures, undisposed listeners, circular references).
- Loop construct by need: `for (let i = 0; ...)` for performance-critical or index-dependent work, `for...of` for simple array iteration, `for...in` only for object property enumeration.

### Type Safety

- **Never use `any`.** Explicit types for all parameters, return values, and variables.
- **Limit `unknown`** — avoid `unknown`, `Record<string, unknown>`, and `as unknown as T`. A `Record<string, unknown>` almost always signals a missing explicit type.
- **Don't duplicate types** — check whether one already exists (especially in `packages/data-provider`) and reuse/extend it before defining a new one.
- Use union types, generics, and interfaces appropriately. Resolve all TS/ESLint diagnostics.

### Comments and Documentation

- Write self-documenting code; no inline comments narrating what code does. Avoid standalone `//` comments unless absolutely necessary.
- JSDoc only for complex/non-obvious logic or intellisense on public APIs — single-line for brief docs, multi-line for complex cases.

### Import Order

Three sections:

1. **Package imports** — sorted shortest to longest line length (`react` always first).
2. **`import type` imports** — sorted longest to shortest (package types first, then local types; length resets between sub-groups).
3. **Local/project imports** — sorted longest to shortest.

Multi-line imports count total character length across all lines. Consolidate value imports from the same module. Always use standalone `import type { ... }` — never inline `type` inside a value import.

---

## Frontend Rules (`client/src/**/*`)

### Localization

- All user-facing text must use `useLocalize()`.
- Only update English keys in `client/src/locales/en/translation.json` (other languages are automated externally).
- Semantic key prefixes: `com_ui_`, `com_assistants_`, etc.

### Components

- TypeScript for all React components with proper type imports.
- Semantic HTML with ARIA labels (`role`, `aria-label`) for accessibility.
- Group related components in feature directories (e.g., `SidePanel/Memories/`); use index files for clean exports.

### Data Management

- Feature hooks: `client/src/data-provider/[Feature]/queries.ts` → `[Feature]/index.ts` → `client/src/data-provider/index.ts`.
- React Query (`@tanstack/react-query`) for all API interactions; invalidate queries on mutations.
- QueryKeys and MutationKeys in `packages/data-provider/src/keys.ts`.

### Data-Provider Integration

- Endpoints: `packages/data-provider/src/api-endpoints.ts`
- Data service: `packages/data-provider/src/data-service.ts`
- Types: `packages/data-provider/src/types/queries.ts`
- Use `encodeURIComponent` for dynamic URL parameters.

### Performance

- Prioritize memory and speed at scale; cursor pagination for large datasets.
- Correct dependency arrays to avoid needless re-renders; leverage React Query caching and background refetching.

---

## Development Commands

| Command | Purpose |
|---|---|
| `npm run smart-reinstall` | Install deps (if lockfile changed) + build via Turborepo |
| `npm run reinstall` | Clean install — wipe `node_modules` and reinstall from scratch |
| `npm run backend` | Start the backend server |
| `npm run backend:dev` | Start backend with file watching (development) |
| `npm run build` | Build all compiled code via Turborepo (parallel, cached) |
| `npm run frontend` | Build all compiled code sequentially (legacy fallback) |
| `npm run frontend:dev` | Start frontend dev server with HMR (port 3090, requires backend running) |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after changes |

- Node.js: v20.19.0+ or ^22.12.0 or >= 23.0.0
- Database: MongoDB
- Backend runs on `http://localhost:3080/`; frontend dev server on `http://localhost:3090/`

---

## Testing

- Framework: **Jest**, run per-workspace from its directory: `cd api && npx jest <pattern>`, `cd packages/api && npx jest <pattern>`, etc.
- Frontend tests: `__tests__` directories alongside components; use `test/layout-test-utils` for rendering. Cover loading, success, and error states.

### Philosophy

- **Real logic over mocks.** Exercise actual code paths with real dependencies; mocking is a last resort.
- **Spies over mocks.** Assert real functions are called with expected arguments/frequency without replacing the underlying logic.
- **MongoDB**: use `mongodb-memory-server` for a real in-memory instance — test actual queries and schema validation, not mocked DB calls.
- **MCP**: use real `@modelcontextprotocol/sdk` exports for servers, transports, and tool definitions — mirror real scenarios, don't stub SDK internals.
- Only mock what you cannot control: external HTTP APIs, rate-limited services, non-deterministic system calls. Heavy mocking is a code smell.

---

## Formatting

Auto-fix all formatting lint errors (trailing spaces, tabs, newlines, indentation). All TypeScript/ESLint warnings and errors **must** be resolved.
