# Security Policy

## Supported versions

Security fixes target the latest `1.x` release. StarRouter `1.2.0` requires Node.js `>=22.19.0` and Pi `>=0.80.6`; Pi `0.80.6` through `0.80.10` are covered by the compatibility matrix.

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

An optional Artificial Analysis key is read from the environment variable named by trusted global configuration. Authorization headers are attached only when the request origin is exactly `https://artificialanalysis.ai`. Absolute paths or redirects to another origin do not receive that secret. Custom global endpoints are allowed for a trusted user, but they receive no Artificial Analysis secret headers.

Provider credentials remain owned by Pi. StarRouter reads model availability and auth status metadata; it must not log or persist provider tokens.

## Network and cache behavior

Core routing may contact only the benchmark data source configured by the trusted global file:

1. the configured API path on the official Artificial Analysis origin by default;
2. the configured Artificial Analysis page as a parsing fallback;
3. no classifier or provider inference endpoint.

Requests have a timeout and bounded response bodies. Cache bytes, model/profile counts, external string lengths, and control characters are bounded before use. Unknown optional AA prompt buckets are ignored; recognized buckets and dataset/cache structure remain strict. API host-model rows without host metadata are rejected. Parenthetical host/deployment qualifiers are preserved, generic aliases cannot certify qualified deployments, and true duplicate rows select one coherent source row. `hostApiId` separates hosted API routes but cannot certify host-scoped evidence. Direct-provider host mismatch is rejected. For `openrouter`, `vercel-ai-gateway`, `github-copilot`, `opencode`, `opencode-go`, and `cloudflare-ai-gateway`, a hosted mismatch or unhosted page row may supply only model quality: AA host price, speed, E2E, TTFT, token burn, and context fallback are suppressed and confidence is penalized. `cheapest`/`fastest` abstain when their primary evidence is absent. A fresh cache is preferred; explicit refresh bypasses it, obsolete generations cannot overwrite a newer cache, and network failure may retain a validated stale cache fallback with a warning. Cache, configuration, and saved-preset writes use same-directory temporary files and atomic rename. A cache persistence failure cannot invalidate already validated network data for the current run. If no trustworthy data remains, StarRouter abstains and keeps the current route.

The cache at `~/.pi/agent/cache/star-router-public.json` contains public model/benchmark metadata and source metadata. It does not contain prompt text, images, conversation content, provider responses, or credentials. Artificial Analysis remains an external dependency; its schema and content can change.

## Observability and replay

The `1.2.0` observability layer is additive and has no routing authority. A `DecisionTraceV1` or routing-attempt trace is assembled only from data already used or produced by the deterministic kernel. Trace assembly is best-effort: an observability failure cannot undo or alter an applied route.

Operational traces remain in process memory and are cleared when StarRouter restores or changes the active session branch. They record bounded prompt metadata (character count and image presence), derived profile signals/notes, provider scope, candidate identities, benchmark attribution, scores, provenance, and the applied route. They do not contain raw prompt text, prompt hashes, image bytes, conversation content, model responses, environment values, or credentials, and they are not written into Pi session entries.

`/router replay export` is the only replay persistence path. It projects route-relevant fields into a versioned bundle containing the derived profile, route strategy and model overrides, available-model snapshots, validated AA rows/statistics, and expected route/ranking/score evidence. It excludes data-source configuration, API-key environment names/values, raw prompts, and prompt hashes. The default location is `~/.pi/agent/extensions/star-router/replays/`; newly created parent directories request mode `0700`, and files use atomic replacement with mode `0600` on supported Unix filesystems.

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
- Audit the shipped StarRouter surface with `npm audit --omit=dev --audit-level=low`. The 2026-07-27 full development-tree audit additionally reports upstream DoS advisories in `brace-expansion@5.0.6` and `protobufjs@7.6.4` embedded by the Pi CLI npm shrinkwrap. They are not shipped by StarRouter or called by its extension, but remain a local/CI tooling risk until Pi updates its shrinkwrap.
