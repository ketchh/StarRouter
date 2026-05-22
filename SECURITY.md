# Security Policy

## Supported Versions

This project is stable as of `1.0.0`. Security fixes target the latest supported `1.x` release branch.

## Reporting a Vulnerability

Please open a private security advisory or contact the maintainer before publishing details publicly.

Include:

- pi version and Node.js version
- provider configuration involved
- extension configuration redacted of secrets
- reproduction steps
- expected vs actual behavior

## Sensitive Data Handling

The extension may read local Pi configuration, provider auth status, and model registry metadata. It must not log API keys or OAuth tokens.

Generated cache/report files may include:

- selected model/provider names
- prompt text from test suites
- routing decisions and benchmark summaries
- approximate cost/tuning data

Do not commit generated reports containing private prompts unless reviewed.

## Network Calls

The core extension fetches Artificial Analysis public/API data and may use the selected provider model for prompt classification when configured. The debug companion can run multiple classifier/preview requests during suite testing.
