# Security Policy

## Supported versions

Security fixes target the latest `1.x` release. StarRouter `1.1.0` requires Node.js `>=22.19.0` and Pi `>=0.80.6`.

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

Project values for `enabled`, `strategy.routingProvider`, `ui.autoAcceptRouting`, or `dataSource` are ignored. Consequently, checking out a repository cannot silently enable routing, auto-accept switches, select a different provider, redirect benchmark traffic, or request a secret-bearing header.

### Secret headers and custom endpoints

An optional Artificial Analysis key is read from the environment variable named by trusted global configuration. Authorization headers are attached only when the request origin is exactly `https://artificialanalysis.ai`. Absolute paths or redirects to another origin do not receive that secret. Custom global endpoints are allowed for a trusted user, but they receive no Artificial Analysis secret headers.

Provider credentials remain owned by Pi. StarRouter reads model availability and auth status metadata; it must not log or persist provider tokens.

## Network and cache behavior

Core routing may contact only the benchmark data source configured by the trusted global file:

1. the configured API path on the official Artificial Analysis origin by default;
2. the configured Artificial Analysis page as a parsing fallback;
3. no classifier or provider inference endpoint.

Requests have a timeout and bounded response bodies. Cache bytes, model/profile counts, external string lengths, and control characters are bounded before use. Unknown optional AA prompt buckets are ignored; recognized buckets and dataset/cache structure remain strict. API host-model rows without host metadata are rejected. Host certification uses only `hostLabel`/`hostSlug`; `hostApiId` is model identity metadata and cannot certify host-scoped evidence. Direct-provider host mismatch is rejected. For `openrouter`, `vercel-ai-gateway`, `github-copilot`, `opencode`, `opencode-go`, and `cloudflare-ai-gateway`, a hosted mismatch or unhosted page row may supply only model quality: AA host price, speed, E2E, TTFT, token burn, and context fallback are suppressed and confidence is penalized. `cheapest`/`fastest` abstain when their primary evidence is absent. A fresh cache is preferred; explicit refresh bypasses it, obsolete generations cannot overwrite a newer cache, and network failure may retain a validated stale cache fallback with a warning. If no trustworthy data remains, StarRouter abstains and keeps the current route.

The cache at `~/.pi/agent/cache/star-router-public.json` contains public model/benchmark metadata and source metadata. It does not contain prompt text, images, conversation content, provider responses, or credentials. Artificial Analysis remains an external dependency; its schema and content can change.

## Persisted session data

StarRouter persists product state only:

- enabled/disabled state for the active branch;
- compact route decision summaries (provider/model, thinking level, scores, and rationale metadata);
- a `null` decision marker when confirmation is cancelled and ambient decision UI is cleared.

Restored decision objects are schema-checked and bounded before status/widget rendering; malformed custom entries are ignored.

It does not persist raw prompt text as routing telemetry. Saved filter presets and JSON configuration can reveal model/provider preferences but should not contain secrets.

## Operational guidance

- Keep `ui.autoAcceptRouting` off when explicit review is required.
- Review global `dataSource` and `apiKeyEnv` changes as privileged changes.
- Do not accept project `modelOverrides` without checking creator, exact version, evidence scope, and reasoning class. Pins cannot bypass identity gates or restore suppressed host metrics.
- Protect the global config with user-only permissions; StarRouter writes it with mode `0600` on supported Unix filesystems.
- Treat a stale benchmark cache as degraded-but-usable metadata, not proof that prices or availability are current.
- Run `npm test` for offline deterministic validation; its preload denies standard in-process Node network APIs but is not an OS sandbox. Run `npm run test:live` only when explicit network observation is intended.
