# StarRouter for Pi

StarRouter is a focused model-routing extension for Pi. It chooses the best available model and thinking level for each prompt using a deterministic heuristic prompt profiler, Artificial Analysis benchmark data, provider-scoped model pools, strict model identity matching, and an explicit confirmation UI.

The V1 goal is intentionally narrow: **make routing trustworthy, explainable, and easy to control**. StarRouter does not call a hidden classifier model before your prompt, does not expose policy-profile sprawl, and does not auto-switch unless you explicitly allow it.

---

## Install

Install from npm as a Pi package:

```bash
pi install npm:pi-star-router
```

Reload the current Pi session:

```text
/reload
```

Open settings and enable routing:

```text
/router settings
/router on
```

Try it without a global install:

```bash
pi -e npm:pi-star-router
```

---

## Command surface

StarRouter keeps the public command surface small:

```text
/router status
/router on
/router off
/router refresh
/router settings
```

| Command | What it does |
| --- | --- |
| `/router status` | Shows whether the router is enabled and summarizes the latest route decision. |
| `/router on` | Enables routing for future turns. |
| `/router off` | Disables routing and leaves model selection manual. |
| `/router refresh` | Refreshes the cached Artificial Analysis dataset. |
| `/router settings` | Opens the interactive settings UI. |

Routing is **off by default**. You opt in when you want StarRouter to choose.

---

## What happens before a turn

When routing is enabled and you submit a prompt, StarRouter runs this pipeline:

1. **Profile the prompt locally**
   - detects coding, debugging, architecture, research, structured output, long-context, vision, simple-output, and mechanical-transform signals;
   - estimates complexity and routing tier;
   - picks a target thinking level.

2. **Choose benchmark weights**
   - maps the prompt to relevant Artificial Analysis metrics such as Coding, Terminal-Bench Hard, IFBench, GDPval, Tau2, GPQA, or AA-LCR.

3. **Scope the candidate pool**
   - compares only models from the configured provider;
   - applies benchmark-safe family/model filters;
   - generates candidates only for thinking levels the Pi model actually supports.

4. **Match Pi models to Artificial Analysis rows**
   - checks vendor, family, subfamily, generation, moving aliases, variant level, and host affinity;
   - allows explicit model overrides for known provider/AA naming drift.

5. **Score candidates**
   - blends benchmark fit, estimated cost, latency, speed, context window, model specialization, and thinking-level fit.

6. **Apply hard constraints**
   - filters text-only models for vision prompts;
   - applies long-context requirements;
   - enforces thinking floors/caps for difficult or simple tasks;
   - abstains if confidence is too low.

7. **Ask before switching**
   - by default, StarRouter opens a route confirmation panel;
   - you can keep the current model with `Esc`, or accept the focused route with `Enter`.

8. **Explain the decision**
   - a compact widget shows the selected model, thinking level, confidence, benchmark fit, and trade-off summary.

---

## Core features

### Deterministic heuristic prompt profiler

StarRouter’s profiler is local and deterministic. It uses modular English and Italian dictionaries plus structural signals such as code blocks, file mentions, list fan-out, prompt length, images, and long-context phrases.

It produces:

- `routingTier`: `booster`, `simple`, `standard`, `complex`, or `frontier`;
- `complexityScore`;
- matched signals;
- benchmark weights;
- priorities for cost, speed, reasoning, context, vision, tool use, and format reliability;
- target thinking level;
- Artificial Analysis prompt-length profile.

Because no classifier model is called, routing adds no hidden provider latency and no hidden classification cost.

### Provider-scoped routing

StarRouter compares models only inside one provider scope, for example `openrouter` or `github-copilot`.

This keeps decisions understandable: if your provider is GitHub Copilot, StarRouter chooses among GitHub Copilot models; if your provider is OpenRouter, it chooses among OpenRouter models.

### Strict Artificial Analysis matching

Model routing is only as good as benchmark matching. StarRouter uses strict identity gates before a Pi model can use an Artificial Analysis row:

- vendor match;
- family match;
- subfamily match where relevant;
- generation/version compatibility;
- moving-alias protection for names such as `latest`, `auto`, and `free`;
- variant-level compatibility for reasoning and non-reasoning rows;
- host affinity when provider data is available.

Examples of matches StarRouter rejects by default:

- GLM borrowing Claude benchmark rows;
- Claude Sonnet borrowing Claude Haiku rows;
- Hermes 3 borrowing Hermes 4 rows;
- `kimi-latest` silently pinning itself to a fixed Kimi generation.

When a provider name legitimately differs from an AA slug, use `modelOverrides` to pin it explicitly.

### Benchmark-safe filters

Large catalogs can contain free endpoints, auto routers, deprecated aliases, or long-tail models that do not map cleanly to benchmark data. StarRouter includes filter presets such as:

- `benchmark-safe`
- `frontier-safe`
- `coding-safe`
- `budget-safe`

Presets are templates, not locks. You can apply a preset, then use the model filter screen to enable or disable families and individual models.

### Route confirmation panel

With auto-accept off, StarRouter shows an overlay before switching:

- current route;
- recommended route;
- top candidates;
- benchmark fit;
- route score;
- cost score;
- latency score;
- context score;
- confidence;
- short reason bits.

Keyboard controls:

```text
↑↓      focus a route
Space   mark a route
Enter   choose the focused route
Esc     keep the current route
```

### Decision widget

After a route is applied, StarRouter shows a compact widget above the editor with:

- selected provider/model/thinking level;
- confidence;
- selected objective;
- benchmark summary;
- AA match;
- fit/cost/speed/latency/context trade-off;
- short explanation of why the route won.

---

## Routing objectives

StarRouter supports four ranking objectives:

| Objective | Use it when |
| --- | --- |
| `balanced` | Default. Good fit/cost/speed trade-off for everyday agent work. |
| `quality` | Hard debugging, architecture, research, or high-stakes coding. |
| `cheapest` | Bulk, repetitive, low-risk prompts where cost matters most after constraints. |
| `fastest` | Interactive work where latency matters more than absolute quality. |

For a polished first experience, keep `balanced` as the default and change objectives only when you have a clear reason.

---

## Example configuration

StarRouter loads configuration from:

- global: `~/.pi/agent/model-router.json`
- project: `.pi/model-router.json`

Project settings override global settings.

```json
{
  "enabled": false,
  "strategy": {
    "objective": "balanced",
    "qualityFloor": 0.88,
    "preferCurrentWithin": 0.04,
    "minAaMatch": 0.52,
    "minRouteConfidence": 0.42,
    "routingProvider": "github-copilot"
  },
  "ui": {
    "showAdvancedSettings": false,
    "autoAcceptRouting": false
  },
  "filters": {
    "providers": {
      "openrouter": {
        "preset": "benchmark-safe",
        "disabledFamilies": [],
        "disabledModels": []
      }
    }
  }
}
```

See `model-router.json.example` for the full example, including data-source defaults and model overrides.

---

## Competitive data

The latest validation data in this repo showed strong savings against a frontier-baseline mix while preserving hard constraints.

### Projected monthly totals vs frontier baseline mix

| Objective | Router monthly | Baseline monthly | Savings USD | Savings % |
| --- | ---: | ---: | ---: | ---: |
| `balanced` | $305.26 | $1,259.40 | $954.14 | 75.76% |
| `cheapest` | $143.88 | $1,259.40 | $1,115.52 | 88.58% |
| `quality` | $575.25 | $1,259.40 | $684.15 | 54.32% |

### Representative scenario savings

| Scenario | Balanced monthly | Baseline monthly | Savings % |
| --- | ---: | ---: | ---: |
| Mechanical transform | $3.02 | $108.00 | 97.20% |
| JSON extraction | $62.50 | $675.00 | 90.74% |
| Routine coding | $6.80 | $135.00 | 94.96% |
| Long-context repo triage | $20.01 | $116.00 | 82.75% |
| Vision invoice extraction | $2.93 | $23.40 | 87.50% |

### Example routes from the validation snapshot

| Scenario | Balanced route | Cheapest route | Quality route |
| --- | --- | --- | --- |
| Mechanical transform | `deepseek/deepseek-v4-flash @ off` | `deepseek/deepseek-v4-flash @ off` | `deepseek/deepseek-v4-flash @ off` |
| JSON extraction | `google/gemini-3.1-flash-lite @ off` | `google/gemini-3.1-flash-lite @ off` | `google/gemini-3.1-flash-lite @ off` |
| Routine coding | `deepseek/deepseek-v4-flash @ off` | `deepseek/deepseek-v4-flash @ off` | `deepseek/deepseek-v4-flash @ medium` |
| Debugging | `openai/gpt-5.1-codex @ medium` | `deepseek/deepseek-v4-pro @ xhigh` | `openai/gpt-5.1-codex @ medium` |
| Critical architecture | `openai/gpt-5.5 @ xhigh` | `deepseek/deepseek-v4-pro @ medium` | `openai/gpt-5.5 @ xhigh` |
| Long context | `deepseek/deepseek-v4-pro @ medium` | `deepseek/deepseek-v4-pro @ medium` | `openai/gpt-5.5 @ xhigh` |

---

## Validation

Run the release checks:

```bash
npm test
npm run typecheck
npm run smoke
npm run golden -- tests/fixtures/golden-prompts.json /tmp/golden.json
```

Current validation targets:

| Check | Target |
| --- | ---: |
| Release tests | 38 passing tests |
| Golden prompt bank | 80 passing prompts |
| TypeScript | strict typecheck passing |
| Release smoke checks | passing |

---

## Project structure

```text
index.ts                         Pi extension wiring and runtime flow
src/router-core.ts               config, AA ingestion, matching, scoring, ranking
src/prompt-understanding.ts      deterministic heuristic prompt profiler
src/prompt-dictionaries/         modular EN/IT signal dictionaries
src/route-choice-screen.ts       route confirmation overlay and decision widget
src/settings-screen.ts           searchable settings tree
src/model-filters-screen.ts      provider/family/model filter UI
src/filter-presets/              built-in and saved model filter presets
model-router.json.example        example configuration
docs/index.html                  public HTML presentation page
```

---

## Security and trust model

StarRouter is conservative by design:

- it is disabled until you run `/router on`;
- it does not call a hidden classifier model before your prompt;
- it asks before switching by default;
- it scopes routing to the configured provider;
- it rejects suspicious benchmark matches;
- it blocks moving aliases unless explicitly overridden;
- it can abstain instead of forcing a low-confidence route.

---

## License

MIT
