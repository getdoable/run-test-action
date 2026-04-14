# `doableai/trigger-run-action`

Trigger DoableAI regression runs from GitHub Actions.

## Implementation Notes

- Source: `src/index.ts` (TypeScript)
- Runtime entry: `dist/index.js` (compiled artifact referenced by `action.yml`)

When publishing updates, run:

```bash
npm install
npm run lint
npm run build
```

Then commit both source and `dist/` output before tagging.

## Quick Start

```yaml
name: Trigger DoableAI Regression

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger DoableAI group run
        uses: doableai/trigger-run-action@v1
        with:
          trigger-api-url: https://api.doableai.com/api/integrations/github/trigger-run
          trigger-token: ${{ secrets.DOABLEAI_TRIGGER_TOKEN }}
          group-id: 437062ea-6c73-46fe-9806-d766d49ec297
```

## Inputs

- `trigger-token` (**required**): Bearer token created in DoableAI Settings -> API Keys.
- `trigger-api-url`: Trigger API URL. Defaults to `https://api.doableai.com/api/integrations/github/trigger-run`.
- `group-id`: Regression group UUID. Exactly one of `group-id` / `schedule-id` is required.
- `schedule-id`: Schedule UUID. Exactly one of `group-id` / `schedule-id` is required.
- `idempotency-key`: Optional dedupe key. If omitted, action auto-generates one from GitHub context.
- `repository-full-name`, `workflow-name`, `branch`, `head-sha`, `github-run-id`, `github-run-attempt`, `conclusion`:
  Optional metadata overrides. Defaults are auto-populated from GitHub Actions env.

## Outputs

- `status`: `created_execution` or `duplicate`.
- `execution-id`: Created/existing execution UUID.
- `execution-public-id`: Created/existing execution public id.
- `http-status`: HTTP status code (`200`, `409`, etc.).
- `idempotency-key`: Final key used by this request.
- `response-body`: Raw API response body.

## Idempotency Behavior

- First request with a key: usually `200` + `created_execution`
- Repeated request with same key: `409` + `duplicate`

This lets CI safely retry without creating duplicate runs.

## Schedule Example

```yaml
- name: Trigger DoableAI schedule run
  uses: doableai/trigger-run-action@v1
  with:
    trigger-token: ${{ secrets.DOABLEAI_TRIGGER_TOKEN }}
    schedule-id: 6bdf3cc8-9f96-4eef-bf7a-8f1d7e0ad67a
    idempotency-key: ${{ github.repository }}:${{ github.run_id }}:${{ github.run_attempt }}:nightly
```
