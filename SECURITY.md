# Security Policy

## Supported versions

Security fixes target the latest `1.x` release. StarRouter `1.2.3` requires Node.js `>=22.19.0` and Pi `>=0.82.1`; Pi `0.82.1` is the pinned compatibility baseline.

## Reporting a vulnerability

Prefer a private GitHub security advisory for <https://github.com/ketchh/StarRouter>. If that is unavailable, contact the maintainer before publishing details.

Include:

- StarRouter, Pi, Node.js, and operating-system versions;
- the provider and runtime mode (`tui`, `rpc`, or `print`);
- redacted global/project configuration;
- minimal reproduction steps and expected/actual behavior;
- whether the issue requires an untrusted project checkout.

Never include API keys, OAuth tokens, private prompts, or full Pi session files in a report.

## Trust model

### Local prompt understanding

Prompt profiling is deterministic local code. StarRouter does not call a classifier model, a debug companion, or another provider before the user's turn. Prompt text and images are not uploaded for routing classification.

Lexical non-recognition is a trust-boundary condition, not evidence that a request is harmless or easy. In `1.2.2`, a general-only profile is marked uncertain and publicly described as `unclassified · limited evidence`. The runtime keeps the active route without opening confirmation or applying a switch; direct kernel callers receive an eligible current candidate with `confidence-fallback` provenance or an abstention. This guard is routing conservatism, not content moderation: provider/model safety policies and tool permissions remain separate controls.

### Provider boundary

Routing is restricted to the globally configured provider and currently available Pi models. An unavailable provider does not trigger cross-provider fallback. Identity matching gates vendor, family/subfamily, exact version/generation, moving aliases, and reasoning class before data can influence a route. Host-compatible evidence is marked `host-verified`. A narrow explicit aggregator allowlist may accept an identity-compatible row from another host as `model-only`, but AA host economics/performance/context fallback are then removed. Direct-provider host mismatch remains rejected. A `modelOverrides` value is an exact AA-slug alias pin: it bypasses alias similarity only. Cross-vendor, version-missing/mismatched, reasoning-mismatched, and host-slug-as-model attempts remain rejected.

### Configuration boundary

The global file (`~/.pi/agent/model-router.json`) is trusted user configuration. It may enable routing, select the provider, enable auto-accept, and change the benchmark data source.

A repository-controlled project file (`.pi/model-router.json`) is treated as untrusted. It may override only:

- objective and numeric routing thresholds;
- `ui.showAdvancedSettings`;
- filters;
- explicit model overrides.

Project values for `enabled`, `strategy.routingProvider`, `ui.autoAcceptRouting`, or `dataSource` are ignored. Consequently, checking out a repository cannot silently enable routing, auto-accept switches, select a different provider, redirect benchmark traffic, or request a secret-bearing header. Config files are read with a 1 MiB ceiling; filter/override identifiers and collections are bounded, and prototype-sensitive object keys are rejected before merge.

### Secret headers and custom endpoints

An optional Artificial Analysis key is read from the environment variable named by trusted global configuration. The supported V2 integration sends it only as `x-api-key`, and only when the request origin is exactly `https://artificialanalysis.ai`. Compatible legacy official endpoints may retain their legacy authorization header. Custom global endpoints receive no Artificial Analysis secret headers; neither do absolute paths or redirects to another origin. The credential-free default uses the public leaderboard and sends no key.

Provider credentials remain owned by Pi. StarRouter reads model availability and auth status metadata; it must not log or persist provider tokens.

## Network and cache behavior

Core routing may contact only the benchmark data source configured by the trusted global file:

1. the public Artificial Analysis model leaderboard by default;
2. an explicitly selected official V2 or compatible legacy API path;
3. no classifier or provider inference endpoint.

Requests have a timeout and bounded response bodies. V2 pagination has strict page, cumulative-byte, row, and duplicate limits. V2 `401`/`403` access failures are not converted into page success. Exact retired official defaults migrate to the current credential-free page source; custom API sources are preserved, and incompatible old cache keys are rejected.

Current page and V2 collection rows are projected to model-only quality fields. Host identity, prices, speed, E2E, TTFT, token burn, context fallback, and uncertified prompt buckets are removed before caching. Compatible legacy host-model rows remain strict: rows without host metadata are rejected, parenthetical deployment qualifiers are preserved, generic aliases cannot certify qualified deployments, and `hostApiId` cannot certify a host. Direct-provider host mismatch is rejected. For aggregators, a hosted mismatch or unhosted model-only row may supply quality only, confidence is penalized, and `cheapest`/`fastest` abstain when primary evidence is absent. A fresh cache is preferred; explicit refresh bypasses it, obsolete generations cannot overwrite a newer cache, and failure may retain a validated stale cache for at most 30 days and only when its source key remains compatible. Atomic write guarantees remain unchanged. If no trustworthy data remains, StarRouter abstains and keeps the current route.

The cache at `~/.pi/agent/cache/star-router-public.json` contains public model/benchmark metadata and source metadata. It does not contain prompt text, images, conversation content, provider responses, or credentials. Artificial Analysis remains an external dependency; its schema and content can change.

## Observability and replay

The `1.2.0` observability layer is additive and has no routing authority. A `DecisionTraceV1` or routing-attempt trace is assembled only from data already used or produced by the deterministic kernel. Trace assembly is best-effort: an observability failure cannot undo or alter an applied route.

Operational traces remain in process memory and are cleared when StarRouter restores or changes the active session branch. They record bounded prompt metadata (character count and image presence), derived profile signals/notes, provider scope, candidate identities, benchmark attribution, scores, provenance, and the applied route. The `1.2.2` insufficient-profile-evidence outcome records only the bounded outcome/reason plus prompt length and image presence. Traces do not contain raw prompt text, prompt hashes, image bytes, conversation content, model responses, environment values, or credentials, and they are not written into Pi session entries.

`/router replay export` is the only replay persistence path. It projects route-relevant fields into a versioned bundle containing the derived profile, route strategy and model overrides, available-model snapshots, validated AA rows/statistics, and expected route/ranking/score evidence. V1 replay is a delta detector against the current kernel, not an emulator of the captured implementation: a pre-`1.2.2` general-only bundle remains readable and may report the intentional conservative-policy delta. It excludes data-source configuration, API-key environment names/values, raw prompts, and prompt hashes. The default location is `~/.pi/agent/extensions/star-router/replays/`; newly created parent directories request mode `0700`, and files use atomic replacement with mode `0600` on supported Unix filesystems.

Replay reads and writes are limited to 16 MiB. Validators reject undeclared fields, control characters, prototype-sensitive structures, sparse arrays, excessive model/profile counts, and more than 2,000,000 route-to-AA match combinations. Verification isolates the AA match cache, uses the bundle capture time for portable dataset validation, performs no network request, and re-runs the frozen route kernel rather than prompt profiling. The bundle SHA-256 covers every replay kernel input, including the derived profile and prompt metadata. It detects mutation but is **not** a signature or proof of origin. Do not accept an untrusted replay merely because its checksum is internally consistent, and protect exports because model availability, overrides, strategy, and benchmark snapshots may still be sensitive operational metadata.

## Persisted session data

StarRouter persists product state only:

- enabled/disabled state for the active branch;
- compact route decision summaries (provider/model, thinking level, scores, and rationale metadata);
- a `null` decision marker when confirmation is cancelled and ambient decision UI is cleared.

Restored decision objects are schema-checked and bounded before status/widget rendering; malformed custom entries are ignored. New entries retain recommendation basis and algorithmic identity independently from application origin and the route actually applied, while legacy 1.1.0 entries remain readable.

It does not persist raw prompt text as routing telemetry. The in-memory `1.2.0` trace and explicit replay export described above are not session entries. Saved filter presets, JSON configuration, and replay bundles can reveal model/provider preferences but should not contain secrets. Individual presets are limited to 256 KiB, and preset file/directory enumeration is bounded.

## Operational guidance

- Keep `ui.autoAcceptRouting` off when explicit review is required.
- Review global `dataSource` and `apiKeyEnv` changes as privileged changes.
- Do not accept project `modelOverrides` without checking creator, exact version, evidence scope, and reasoning class. Pins cannot bypass identity gates or restore suppressed host metrics.
- Protect the global config with user-only permissions; StarRouter writes it with mode `0600` on supported Unix filesystems.
- Treat a stale benchmark cache as degraded-but-usable metadata, not proof that prices or availability are current.
- Inspect a routing decision with `/router explain`; export a replay only when the frozen model/configuration metadata is appropriate to retain or share.
- Treat replay SHA-256 values as integrity checks, not authentication, and verify bundles only with a trusted StarRouter version.
- Run `npm test` for offline deterministic validation; its preload denies standard in-process Node network APIs but is not an OS sandbox. Run `npm run perf:check` for bounded offline observability timing and `npm run test:live` only when explicit network observation is intended.
- Audit the shipped StarRouter surface with `npm audit --omit=dev --audit-level=low`. On 2026-08-06 that surface reports zero vulnerabilities. The full development tree reports three findings inherited through the Pi `0.82.1` CLI npm shrinkwrap (one moderate and two high), involving `undici` advisories plus `brace-expansion`. They are not shipped in the StarRouter tarball; StarRouter does not call `brace-expansion`, and the affected `undici` belongs to local/CI Pi tooling. Pi `0.82.1` resolves the earlier nested `protobufjs` advisory; a Pi upgrade remains outside the `1.2.3` acquisition patch.
