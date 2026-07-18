# StarRouter for Pi

StarRouter `1.1.1` is a local, deterministic model-routing extension for Pi. Before a turn, it profiles the prompt, compares benchmark-backed candidates **inside one configured provider**, and chooses a model plus supported thinking level. It asks for confirmation by default and can abstain when evidence is weak.

There is no remote classifier and no cross-provider fallback. Artificial Analysis data supplies model measurements; prompt text is never sent there.

## Requirements and installation

- Node.js `>=22.19.0`
- Pi `>=0.80.6` (verified with `0.80.6` through `0.80.10`)

```bash
pi install npm:pi-star-router
```

Then reload Pi and opt in:

```text
/reload
/router settings
/router on
```

For a one-off run:

```bash
pi -e npm:pi-star-router
```

Routing is off by default.

## Command surface

| Command | Behavior |
| --- | --- |
| `/router status` | Reports enabled/disabled state and, when enabled, the latest decision. |
| `/router on` | Enables routing for subsequent turns in the active session branch. |
| `/router off` | Disables routing and removes the ambient decision widget. |
| `/router refresh` | Forces an Artificial Analysis dataset refresh. |
| `/router settings` | Opens transactional settings in TUI mode. |

## Runtime pipeline

1. **Local prompt profile.** English/Italian dictionaries and structural signals detect mechanical transforms, simple output, coding, debugging, architecture, security, research, agentic/tool work, structured output, long context, and vision. Mixed intents are additive: formatting language cannot erase a debugging or security signal.
2. **Task requirements.** The profile sets benchmark weights, context/vision needs, cost and speed sensitivity, a routing tier, and a target thinking level.
3. **Provider scope.** Only currently available text models from `strategy.routingProvider` are eligible. An unavailable configured provider produces no silent fallback to another provider.
4. **Candidate generation.** Provider filters are applied, then candidates are created only for thinking variants supported by Pi/model metadata.
5. **Identity match.** A Pi model may borrow an Artificial Analysis row only after vendor, family/subfamily, generation/version, moving-alias, and reasoning-class checks. Host-compatible rows are `host-verified`. Because AA may not benchmark an aggregator itself, a small explicit allowlist (including OpenRouter) may use an otherwise identity-compatible row as `model-only`; this never relaxes identity gates.
6. **Normalization and ranking.** Qualified host/deployment identity is preserved, and true duplicates select one coherent source row rather than combining the best field from each row. Host-verified evidence can contribute AA price, output speed, latency, and context fallback. Token burn is retained as diagnostic evidence but does not affect ranking. Model-only evidence contributes benchmark/model quality only; economics/context must come from Pi metadata and host performance is unavailable. Latency uses end-to-end evidence pool-wide when any candidate has it; TTFT is used only when the entire pool lacks end-to-end measurements. `balanced` ranks by composite; `quality`, `cheapest`, and `fastest` rank lexicographically by their named primary metric with deterministic tie-breakers. Cheapest/fastest abstain when their primary evidence is absent.
7. **Safety gates.** Vision, context capacity, task thinking floors/caps, minimum AA identity match, and a relative quality floor are hard constraints. Standard weak Pareto filtering removes routes that are no better on any observed dimension. Low overall confidence causes abstention unless a trustworthy current route can be kept.
8. **Hysteresis.** The current route is retained when its objective score is within `preferCurrentWithin` of the winner, reducing model flapping.
9. **Confirmation and explanation.** Auto-accept is off by default. Decisions keep the deterministic recommendation and its basis separate from the applied route and its origin, so a manual alternative cannot be reported as the algorithmic winner. A compact widget records both identities when they differ.

See [`docs/algorithm.md`](docs/algorithm.md) for the ranking invariants and limitations.

## Route confirmation and runtime modes

### TUI

The confirmation overlay focuses the current recommendation. Controls are:

```text
↑ / ↓   move focus
Enter   confirm the focused route
Esc     cancel and keep the current route
```

There is no separate Space-to-mark step. The layout degrades to a compact view on small terminals. The decision widget above the editor is capped at four lines.

### RPC

Route confirmation uses Pi's serializable `ctx.ui.select()` surface. Decision widgets are plain text lines rather than TUI component factories, so RPC clients receive useful rationale.

### Print/headless

`/router status` prints a plain text result. Transactional settings require TUI and direct users to edit JSON otherwise. If confirmation is required but no interactive UI exists, StarRouter conservatively keeps the current route. Set global `ui.autoAcceptRouting` only when unattended switching is intentional.

## Transactional settings and filters

Open `/router settings` in TUI mode. All edits stay in an in-memory draft until:

```text
Ctrl+S   save the selected global or project draft
Esc      cancel without writing
```

Switching the save target keeps independent global and project drafts. In project scope, global-only controls are visibly inherited and read-only.

The model-filter screen is also transactional:

```text
Enter          toggle the focused family/model
Ctrl+S         apply the filter draft to the settings draft
Esc            cancel filter edits
Ctrl+Shift+S   save a named preset without applying the draft
```

Built-in presets (`benchmark-safe`, `frontier-safe`, `coding-safe`, `budget-safe`) are templates, not locks. Configuration and saved-preset reads are byte/count/string bounded; malformed, oversized, or prototype-sensitive project JSON is ignored rather than merged.

## Configuration and trust boundary

Configuration is loaded from:

- global: `~/.pi/agent/model-router.json`
- project: `.pi/model-router.json`

[`model-router.json.example`](model-router.json.example) is a **complete global example**. It includes privileged controls and data-source settings. [`model-router.project.json.example`](model-router.project.json.example) contains only project-safe fields.

### Global configuration can control

- `enabled`
- `strategy.routingProvider`
- `ui.autoAcceptRouting`
- all `dataSource` fields, including endpoint and optional API-key environment variable
- all project-safe fields below

### Project configuration can control only

- `strategy.objective`
- `strategy.qualityFloor`
- `strategy.preferCurrentWithin`
- `strategy.minAaMatch`
- `strategy.minRouteConfidence`
- `ui.showAdvancedSettings`
- `filters`
- `modelOverrides`

Project attempts to set `enabled`, `strategy.routingProvider`, `ui.autoAcceptRouting`, or `dataSource` are ignored. This prevents a checked-out repository from enabling routing, changing providers, auto-accepting switches, redirecting benchmark traffic, or selecting secret headers.

## Dataset, network, and cache behavior

StarRouter's only core network dependency is benchmark metadata:

1. it requests the configured Artificial Analysis API path;
2. if API parsing/fetching fails, it can parse the configured Artificial Analysis page fallback;
3. a validated cache is stored atomically at `~/.pi/agent/cache/star-router-public.json`;
4. a fresh validated cache is preferred, and a stale validated cache may be used if both network paths fail; failure to persist an already validated network snapshot is non-fatal for the current run;
5. `/router refresh` bypasses a fresh disk cache and reports whether it reached the network or retained a validated stale fallback;
6. responses, caches, model/profile counts, and external strings are bounded and validated before routing;
7. unknown optional AA prompt buckets are ignored while recognized routing profiles remain strict;
8. if no trustworthy dataset is available, routing is skipped and the current route is kept.

Fetches are single-flight and bounded by `requestTimeoutMs`. Dataset/cache rows are validated before use, and obsolete generations cannot overwrite a newer cache. Qualified host labels such as `Google (AI Studio)`, `Google (Vertex)`, and `DeepInfra (Turbo)` remain distinct. Deployment grouping includes `hostApiId`, but that field can never certify host economics; host proof uses exact normalized `hostLabel`/`hostSlug` aliases. A direct-provider host mismatch is rejected. For the explicit aggregator allowlist only, a hosted mismatch becomes degraded **model-only** evidence: AA host price/speed/E2E/TTFT/token-burn/context fallback are suppressed, confidence is reduced, and rationale says so. Unhosted page-scrape rows use the same model-only scope. Secret headers are attached only to the official `https://artificialanalysis.ai` origin; a custom global endpoint does not receive them.

Artificial Analysis is an external source whose page/API schema and measurements may change. `/router refresh` is therefore an operational refresh, not a guarantee that every provider model will match.

## Privacy and persisted state

- Prompt profiling runs locally and deterministically.
- No prompt text, images, Pi conversation content, provider tokens, or model responses are sent to Artificial Analysis.
- There are zero classifier-model calls.
- Session entries persist only enabled state and compact route-decision summaries; recommendation basis and application origin are separate, and cancellation persists a `null` clear marker so an old widget is not resurrected.
- The public dataset cache contains benchmark/model metadata, not prompts.
- StarRouter reads provider availability/auth **status** from Pi but does not log or persist provider secrets.

See [`SECURITY.md`](SECURITY.md) for the full trust model and reporting path.

## Reproducible validation

The default suite is deliberately offline. Its preload denies Fetch/WebSocket and the standard in-process Node HTTP(S), HTTP/2, TCP, TLS, UDP, and DNS entry points unless a test replaces `fetch()` with a local deterministic stub. This is a regression guard, not an operating-system sandbox: it intentionally does not claim to contain malicious child processes or native code.

```bash
npm test                 # alias for test:offline
npm run test:offline     # 126 deterministic offline tests
npm run golden           # 80/80 checked-in golden prompts
npm run typecheck
npm run smoke
npm audit --audit-level=low
npm pack --dry-run --json
```

Current release targets: **126 offline tests**, **80/80 golden prompts**, strict TypeScript, release smoke checks, audit, package-content inspection, and Pi `0.80.6`–`0.80.10` compatibility CI.

Live OpenRouter catalog observations are opt-in and are not a PR gate:

```bash
npm run test:live        # 8 tests, one shared request per external source/file
npm run test:all         # offline first, then live
```

The live suite makes two external requests (one shared OpenRouter request and one shared Artificial Analysis request) to check current catalog/schema shape, representative IDs, parseable prices, and model-only aggregator compatibility. It intentionally makes no universal savings claim. To evaluate cost for your workload, record the observation timestamp, exact provider/model IDs, input/output/cache token counts, provider fees, and the baseline selection policy; then rerun the comparison when catalog prices change.

## Troubleshooting

**`Router status → disabled`**

Run `/router on`, or save `enabled: true` in the global file. Project config cannot enable routing.

**Configured provider shows unavailable**

Authenticate/configure that provider in Pi or change the global routing provider. StarRouter will not borrow another provider silently.

**No trustworthy route**

The provider may have no benchmarkable available model, an identity/host gate may reject the match, or confidence may be below the configured floor. Keep the current route, inspect filters/overrides, and run `/router refresh`.

**Dataset refresh fails**

Check connectivity, the configured timeout, and the Artificial Analysis endpoint. A validated stale cache is used when available; otherwise routing abstains.

**Settings unavailable in RPC/print**

Edit the appropriate JSON file. Keep privileged fields in the global file.

**A model name does not match AA**

Add a narrow `modelOverrides` slug pin after verifying creator, exact version, evidence scope, and reasoning class. The pin resolves alias naming only; contradictory or missing fixed identity evidence is still rejected. A versioned moving alias can be pinned explicitly, with reduced confidence. For aggregator model-only evidence, AA host economics remain suppressed even when pinned.

## Repository map

```text
index.ts                            Pi lifecycle, commands, runtime routing
src/router-core.ts                  config trust boundary, AA ingestion, ranking
src/prompt-understanding.ts         deterministic EN/IT prompt profiler
src/route-choice-screen.ts          responsive confirmation and widgets
src/settings-screen.ts              transactional settings UI
src/model-filters-screen.ts         transactional provider/model filters
src/filter-presets/                 built-in and saved presets
docs/algorithm.md                   algorithm invariants and limitations
docs/index.html                     self-contained public project page
tests/*.test.ts                     deterministic offline release suite
tests/live/*.live.test.ts           explicit network observations
model-router.json.example           complete global example
model-router.project.json.example   project-safe example
```

## Release notes and license

See [`CHANGELOG.md`](CHANGELOG.md) for `1.1.1` fixes and the original `1.0.0` migration notes. Licensed under MIT.
