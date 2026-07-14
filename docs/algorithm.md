# StarRouter routing algorithm

This document describes the `1.1.0` invariants. The implementation in `src/router-core.ts` and `src/prompt-understanding.ts` is authoritative.

## 1. Signals and precedence

Prompt understanding is local and deterministic. English/Italian lexical dictionaries are combined with structural evidence: code fences, file/path mentions, requested task fan-out, prompt length, image presence, and long-context language.

Signals are additive rather than a first-match classifier. In particular, `debugging`, `architecture`, `security`, `critical-system`, and high-stakes `research` prevent mechanical/formatting words from collapsing a mixed prompt into a cheap transform. Vision and long-context requirements are carried independently. The result contains:

- normalized benchmark weights;
- priorities for reasoning, cost, speed, context, vision, tool use, and format reliability;
- `booster` / `simple` / `standard` / `complex` / `frontier` tier;
- target thinking level and AA prompt-length profile;
- uncertainty notes for ambiguous/mixed cases.

The profiler does not call a model and does not inspect provider responses.

## 2. Candidate generation

The globally configured routing provider is a hard scope. StarRouter starts from Pi models that are currently available, accept text, belong to that provider, and survive provider/family/model filters. It never fills an empty scope with another provider.

For each model it enumerates only thinking levels supported by Pi metadata. Non-reasoning models generate only `off`; mapped reasoning models can generate supported levels through `max`. Vision prompts remove non-image models before matching.

A candidate is `(Pi model, thinking level, AA row)`, not merely a model name.

## 3. Identity gates

Automatic AA matching normalizes aliases but applies compatibility gates before similarity can win:

- creator/vendor;
- model family and relevant subfamily;
- generation/version tokens;
- moving aliases (`latest`, `auto`, `free`) versus fixed rows;
- reasoning versus non-reasoning variant;
- AA evidence scope for the configured provider.

A candidate below `minAaMatch` is rejected. Explicit `modelOverrides` are exact AA-slug alias pins: they bypass only alias similarity. Override targets still pass creator, family/subfamily, fixed generation/version, and reasoning-class checks. A versioned moving alias may be pinned, but the moving-alias pin carries lower match confidence; an unversioned alias cannot invent missing fixed identity. `hostSlug` is never interpreted as a model override target. Host mismatch can change only evidence scope under the narrow aggregator policy below; it never repairs identity.

## 4. Host normalization

AA may publish multiple host rows for the same model slug. Rows are grouped by slug **and host identity**, so measurements from different hosts are not averaged into a fictitious route. Duplicate rows for the same slug/host are consolidated. Matching assigns one explicit scope:

- `host-verified`: exact/strong compatible host; full AA host evidence is available;
- `model-only`: an identity-compatible hosted mismatch for the explicit aggregator allowlist (`openrouter`, `vercel-ai-gateway`, `github-copilot`, `opencode`, `opencode-go`, `cloudflare-ai-gateway`), or an unhosted page row.

A direct-provider host mismatch and an API host-model row without host metadata fail closed. Host certification uses only AA `hostLabel`/`hostSlug`; `hostApiId` is a model API identifier and may help model alias similarity but can never certify host scope. Model-only evidence contributes benchmark/model quality only. AA price fallback, speed, E2E, TTFT, token burn, and AA context fallback are suppressed; Pi-declared price/context remain usable. It receives a match/confidence penalty and an explicit rationale bit. Host-verified deterministically outranks model-only, then score and stable row identity decide.

## 5. Metric normalization

Benchmark fit is the weighted mean of available prompt-relevant AA metrics after min/max normalization over the validated dataset. Missing metrics do not contribute weight.

Candidate dimensions are normalized to `[0,1]`:

- price: min/max among current candidates, inverted so lower is better (Pi price or host-verified AA fallback only);
- speed: host-verified candidate-pool range for the selected prompt-length profile;
- latency: host-verified candidate-pool end-to-end range, inverted, when at least one route has E2E evidence; otherwise every host-verified route uses the separately normalized TTFT range;
- context: logarithmic Pi context window (or host-verified AA fallback), then min/max among candidates;
- quality: weighted normalized benchmark fit.

Range normalization is relative to the loaded snapshot. Therefore a score is useful for comparing candidates in that run, not as a timeless absolute grade. Unknown prices reduce confidence rather than being presented as verified savings.

## 6. Objective ranking

Every candidate receives an explainable composite:

```text
quality × wq + cost × wc + speed × ws + latency × wl + context × wx
```

Base weights adapt to prompt priorities; the configured objective shifts those weights for the displayed composite. Match margin, model specialization, efficiency, and distance from the target thinking level add bounded bonuses/penalties. Specialization and efficiency are soft scoring signals only; they never hard-delete an otherwise eligible candidate.

Final ordering is intentionally objective-explicit:

- `balanced`: adaptive composite first;
- `quality`: benchmark fit first;
- `cheapest`: published/estimated price first, or abstain when no eligible finite Pi/host-verified price exists;
- `fastest`: normalized host-verified latency/throughput first, or abstain when no eligible host-performance evidence exists.

The remaining dimensions act as lexicographic tie-breakers, followed by a complete stable identity order: provider, model ID, thinking order, AA slug, and host. Simple efficiency routing has the same final identity tie-break. No random value or wall-clock input participates in route ranking.

## 7. Hard constraints and quality floor

Before final ranking, profile constraints can require:

- image input;
- a minimum context window derived from long-context need;
- minimum thinking for frontier, critical-system, architecture, security, debugging, research, or high reasoning need;
- maximum economical thinking for clearly simple/mechanical work where appropriate.

After constraints, candidates below a relative fraction of the best benchmark fit are removed. The fraction derives from `qualityFloor`, tier, objective, and explicit cost/speed sensitivity. If that filter would remove every constrained candidate, the constrained set remains available rather than manufacturing an empty result.

## 8. Pareto frontier

Eligible candidates are Pareto-filtered across quality, economy, speed, latency, and context using standard weak dominance with only a numerical epsilon (`1e-9`). Candidate A dominates B only if A is no worse across every compared dimension and strictly better in at least one. A business-level tolerance cannot erase a real trade-off. Ranking normally occurs on the non-dominated frontier.

Pareto filtering limits a weighted sum's ability to select a route that is simply worse on all observable dimensions. It cannot compensate for missing or stale measurements.

## 9. Confidence and abstention

Confidence combines:

- identity match margin (`48%`);
- thinking/constraint fit, including prompt uncertainty (`34%`);
- whether price evidence is present (`18%`).

Model-only evidence and explicit moving-alias pins apply additional penalties and notes. An override is never treated as arbitrary maximum confidence.

If the winner is below `minRouteConfidence`, StarRouter keeps a trustworthy current candidate when one exists; otherwise it abstains and performs no switch. No candidate, unavailable provider, failed dataset validation, or unsatisfied hard constraints also produce abstention.

Confidence describes route evidence under this heuristic. It is not a calibrated probability of task success.

## 10. Hysteresis and final ordering

If the current `(model, thinking level)` remains eligible and its objective score is within `preferCurrentWithin` of the winner, it is retained. The chosen route is then placed at `topCandidates[0]`, including when hysteresis or confidence fallback keeps current. This keeps UI focus, persisted summaries, and the applied route consistent.

## 11. Limits

- AA measurements, host rows, model names, prices, and optional prompt buckets can change between refreshes. Unsupported optional buckets are ignored; recognized buckets remain strict. Explicit refresh bypasses a fresh cache, but validated stale fallback remains available and is reported as degraded provenance.
- Benchmark fit is a proxy and may not predict a private workload.
- Lexical prompt understanding can miss novel phrasing or over-weight ambiguous terms.
- Cost estimates do not model every provider fee, cache policy, retry pattern, or dynamic price.
- Provider metadata can omit a supported thinking variant or context capability.
- Explicit overrides are trusted project/user assertions and can be wrong.
- Determinism makes a decision reproducible for the same config/catalog/prompt, not universally correct.

These limits motivate explicit confirmation, strict provider/identity boundaries, and abstention.

## 12. Test strategy

The release suite separates evidence by trust level:

- `npm test` / `test:offline`: 113 deterministic unit, security, cache, lifecycle, TUI/RPC, matching, constraints, ranking, and persistence tests; the preload denies standard in-process Node network entry points (not an OS sandbox);
- `npm run golden`: 80 checked-in EN/IT prompt-profile expectations;
- `npm run test:live`: eight opt-in observations using one shared request per external source/file (OpenRouter and Artificial Analysis); not a PR gate and not a savings benchmark;
- `npm run typecheck` and `npm run smoke`: API/package/documentation surface checks.

A routing change should add a narrow unit regression and, when it changes prompt classification semantics, update or extend the golden bank deliberately. Live catalog failures should be triaged as external drift before changing core ranking.
