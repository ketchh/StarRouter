# Changelog

All notable release changes are documented here.

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
