# Changelog

All notable release changes are documented here.

## Unreleased

### Artificial Analysis acquisition repair

- Replaced the retired credential-free default endpoint with the current public model leaderboard and migrated only the exact retired official configuration; custom API sources remain untouched.
- Added bounded parsing for the current Next Flight camelCase model rows, explicitly skipping the earlier identity-only array and stripping host, price, speed, latency, context, and token-burn fields so public page data remains model-only evidence.
- Added support for the official paginated V2 language-model collection as an explicit keyed mode. V2 rows remain model-only without certified deployment identity, use only `x-api-key`, and fail closed on `401`/`403` rather than disguising entitlement errors as page success.
- Added six offline acquisition/security regressions and updated the opt-in live observation. Routing-kernel formulas, golden prompts, and replay fixtures are unchanged.

## 1.2.2 — 2026-08-06

### Honest low-evidence profiling

- Stopped treating a general-only lexical fallback as affirmative evidence of an easy task. The stable internal `simple` tier remains wire-compatible, while public explanations now say `unclassified · limited evidence` and use neutral detected-complexity labels for recognized tiers.
- Marked general-only profiles uncertain, added a reason-specific note, and raised their provisional thinking target from `off` to `low` without adding phrase-specific rules or a remote classifier.
- Added a conservative guard at both runtime and kernel boundaries: insufficient prompt evidence keeps an eligible current route with existing `confidence-fallback` provenance, otherwise routing abstains. The runtime records a bounded in-memory attempt and never opens confirmation or switches models for this case.
- Excluded limited-evidence profiles from simple-efficiency specialization, economical thinking caps/penalties, and the relaxed simple-task quality floor. Known mechanical and structured-output tasks retain their existing efficiency behavior.

### Documentation and validation

- Replaced raw tier-as-difficulty wording in public explanations with evidence-qualified labels and expanded `/router explain` with detected score, provisional thinking target, and uncertainty state.
- Replaced the stale repository architecture guide with a current 1.2.2 architecture-and-roadmap authority. Profiler/context v2 and its held-out corpus now precede resolver and scoring changes.
- Added six focused offline regressions for the exact out-of-vocabulary prompt, label compatibility, runtime abstention, conservative kernel retention/abstention, primary-evidence guards, exclusion from simple-efficiency specialization, and the intentional historical-replay delta. The release gate is now 155 offline tests plus the unchanged 80/80 golden bank and nine frozen replay fixtures.
- Kept Pi `0.82.1`, trace/replay schema version one, internal tier identifiers, the 80 golden fixture, and all replay fixtures unchanged. Historical general-only V1 bundles remain readable; replay correctly reports the intentional `1.2.2` policy delta instead of rewriting their expected result. The new insufficient-profile attempt outcome is bounded, in-memory only, and never persisted or exported.
- Revalidated the distributed (`--omit=dev`) surface at zero vulnerabilities. The full development tree reports three Pi `0.82.1` tooling findings (one moderate and two high) involving `undici` and `brace-expansion`; they are not shipped in the StarRouter tarball and remain documented pending a Pi update.

## 1.2.1 — 2026-07-27

### Pi compatibility baseline

- Raised the Pi peer requirement from `>=0.80.6` to `>=0.82.1` for `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`.
- Pinned development validation and CI to Pi `0.82.1`, matching the current published Pi SDK/CLI line while preserving Node.js `>=22.19.0`.
- Kept the routing kernel, 149 offline tests, nine replay fixtures, and 80/80 golden prompts unchanged; this patch contains no intentional routing-semantic delta.
- Reduced the full development audit from two upstream Pi shrinkwrap advisories to one: Pi `0.82.1` fixes nested `protobufjs`, while `brace-expansion@5.0.7` remains an upstream CLI-tooling risk and is absent from the StarRouter tarball.

## 1.2.0 — 2026-07-27

This release is observational: it introduces no intentional profiler, resolver, confidence, ranking, or 80-prompt golden-corpus delta.

### Decision observability

- Added versioned, bounded `DecisionTraceV1` records for successful decisions and compact attempt traces for exact follow-ups, empty prompts, unavailable datasets, and abstentions.
- Added `/router explain` with one formatter across TUI, RPC, and print output. Traces expose provider scope, recommendation/application provenance, runner-up evidence, score breakdown, missing metrics, and benchmark coverage without storing the raw prompt or a prompt hash.
- Made benchmark ranking and 14-metric attribution share one numerical implementation; detailed attribution is materialized only for the top three candidates and trace failures remain best-effort.

### Explicit deterministic replay

- Added `/router replay export [bundle.json]` and `/router replay verify <bundle.json>` for explicit private export and network-free route/ranking/score comparison.
- Added strict versioned input projection, full replay-input SHA-256 integrity, atomic `0600` writes, bounded/prototype-safe reads, dense-array checks, capture-time dataset validation, isolated AA match caches, and conservative byte/count/work budgets.
- Kept replay scoped to the frozen deterministic route kernel. It does not persist or reconstruct the original prompt and does not rerun prompt profiling.

### Characterization and release hardening

- Added nine frozen replay fixtures covering all four objectives, hysteresis, confidence fallback, vision filtering, reasoning levels, and moving-alias overrides, with a zero-delta ledger anchored to `3c4c1470bc7aba852a7738c04afc63461cd8dc7d`.
- Added 1.1.1 follow-up characterization plus machine-validated profiler-v2 corpus schema/capacity contracts for 240 single-turn cases, at least 60 multi-turn sequences/200 turns, and 80 held-out cases. The future corpus is specified but not populated in this release; the broader roadmap target of at least 100 decision replays also remains future work.
- Expanded the deterministic offline suite to 149 tests, retained 80/80 golden prompts, and added an offline replay/trace p95 performance budget. The Pi peer contract remains `>=0.80.6` with CI coverage from `0.80.6` through `0.80.10`.
- Kept the shipped StarRouter audit surface at zero findings. The full development tree currently inherits high/moderate denial-of-service advisories for `brace-expansion@5.0.6` and `protobufjs@7.6.4` from the Pi CLI npm shrinkwrap; neither dependency is present in the StarRouter tarball, and the residual tooling risk is documented pending an upstream Pi update.

## 1.1.1 — 2026-07-18

### Evidence integrity

- Preserved qualified Artificial Analysis host/deployment identities such as Google AI Studio versus Vertex and DeepInfra versus DeepInfra Turbo; generic aliases can no longer certify a qualified deployment.
- Included `hostApiId` in deployment grouping and replaced field-wise “best of every row” aggregation with deterministic selection of one complete source row.
- Kept model alias normalization unchanged, limiting routing deltas to the documented host/deployment defects. The 80-prompt golden corpus is unchanged.

### Persistence and local-input hardening

- Made validated network datasets authoritative even when cache persistence fails; cache/config/preset replacement now uses a shared same-directory atomic-write helper with temporary-file cleanup.
- Bounded configuration reads to 1 MiB, preset reads to 256 KiB, preset files to 128, directory entries to 512, and filter/override collections and identifiers to conservative limits.
- Rejected prototype-sensitive JSON keys before merge and made the release smoke test isolate `PI_CODING_AGENT_DIR`, so user-global router state cannot affect its expected disabled status.

### Decision provenance

- Added independent `RecommendationBasis` (`objective-ranking`, `hysteresis`, `confidence-fallback`) and `ApplicationOrigin` (`auto-accept`, `user-recommended`, `user-current`, `user-alternative`) fields.
- Persisted algorithmic recommendation identity separately from the applied route, with objective rank and recommended/applied candidate flags. Manual alternatives no longer rewrite the recommendation rationale.
- Kept legacy 1.1.0 decision entries readable; no session migration is required.

### Pi compatibility and validation

- Verified public extension imports, registry access, model selection, thinking-level handling, TUI/RPC behavior, typechecking, and runtime smoke across Pi `0.80.6` through `0.80.10`.
- Preserved the 1.1.0 peer contract (`>=0.80.6`) and added a five-version Pi compatibility matrix to CI.
- Expanded deterministic coverage to 126 offline tests; all 80 checked-in golden prompts remain passing.

## 1.1.0 — 2026-07-13

### Routing correctness

- Made the configured provider a strict routing boundary; unavailable providers now abstain instead of falling through to another provider.
- Hardened Artificial Analysis matching across creator/family, subfamily, generation/version, moving aliases, reasoning class, and evidence scope; explicit overrides pin aliases only and cannot bypass identity gates.
- Split `host-verified` evidence from aggregator `model-only` evidence so OpenRouter remains usable without borrowing another host's price, speed, latency, token burn, or context fallback; cheapest/fastest abstain when primary evidence is absent.
- Added hard context, vision, and thinking constraints plus confidence-based abstention.
- Made Pareto filtering standard weak dominance, added complete deterministic tie-breaks, separated E2E/TTFT latency pools, and kept objective ranking, hysteresis, and `topCandidates[0]` consistent with the applied route.
- Improved local EN/IT prompt understanding for mixed intents such as debugging plus formatting.
- Added Pi's `max` thinking level.

### Security and resilience

- Treat project configuration as untrusted: it cannot enable routing, choose the routing provider, enable auto-accept, or change data-source/secret settings.
- Send optional Artificial Analysis secret headers only to the official origin.
- Validate and bound fetched/cached datasets, ignore unknown optional AA prompt buckets, use single-flight refreshes, prevent obsolete generations from overwriting cache, force network acquisition on `/router refresh`, and report validated stale fallback provenance without blocking startup.
- Write settings through an atomic temporary-file replace and keep global/project drafts independent.

### UX and runtime modes

- Reworked confirmation around one focused route: Up/Down moves focus, Enter confirms, and Escape explicitly cancels/keeps current.
- Added responsive layouts down to small terminals and a decision widget capped at four lines.
- Added serializable RPC selection and plain-text RPC widgets; print/headless behavior now fails conservatively.
- Made settings and filters transactional with explicit save/apply and cancel controls.
- Made global-only controls visibly inherited and read-only in project scope.
- Persist decision-clear markers and synchronize ambient widgets across branch/session lifecycle events.

### Validation and release

- Raised the runtime baseline to Node.js `>=22.19.0` and Pi `>=0.80.6`.
- Split deterministic offline tests from explicit live OpenRouter observations; the offline preload denies standard in-process Node network entry points without claiming an OS sandbox.
- Added security, cache, lifecycle, settings, RPC, responsive TUI, offline-network, and adversarial routing coverage (113 deterministic offline tests plus 80 golden prompts), with eight opt-in live observations across OpenRouter and Artificial Analysis.
- Replaced non-reproducible savings snapshots with documented validation methodology and opt-in live catalog checks.

## Migrating from 1.0.0

1. Upgrade Node.js to `22.19.0` or newer and Pi to `0.80.6` or newer before installing `1.1.0`.
2. Move `enabled`, `strategy.routingProvider`, `ui.autoAcceptRouting`, and all `dataSource` fields to `~/.pi/agent/model-router.json`. Those keys are ignored in `.pi/model-router.json`.
3. Keep only objective/thresholds, `ui.showAdvancedSettings`, filters, and model overrides in project config. Compare with `model-router.project.json.example`.
4. Review model overrides. A fixed AA slug is rejected when creator, generation, or reasoning identity is incompatible. Aggregator host mismatch is model-only and cannot supply AA host economics.
5. Update TUI habits: there is no Space-to-mark step in route confirmation. Focus a route and press Enter, or press Escape to cancel.
6. Use Ctrl+S to save settings and Ctrl+S to apply filter drafts. Escape cancels. Ctrl+Shift+S saves a filter preset without applying the draft.
7. Use `npm test`/`npm run test:offline` for deterministic CI. Run `npm run test:live` separately when current OpenRouter catalog observation is intended.

No configuration migration runs automatically; normalized defaults fill omitted safe fields at load time.
