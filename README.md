# `getdoable/run-test-action`

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
        uses: getdoable/run-test-action@v1
        with:
          trigger-token: ${{ secrets.DOABLEAI_TRIGGER_TOKEN }}
          group-id: 437062ea-6c73-46fe-9806-d766d49ec297
          wait-for-completion: true
```

## Inputs

- `trigger-token` (**required**): Bearer token created in DoableAI Settings -> API Keys.
- `group-id`: Regression group UUID. Exactly one of `group-id` / `schedule-id` is required.
- `schedule-id`: Schedule UUID. Exactly one of `group-id` / `schedule-id` is required.
- `idempotency-key`: Optional dedupe key. If omitted, action auto-generates one from GitHub context.
- `wait-for-completion`: `true/false`, default `false`. When `true`, action polls until terminal result.
- `poll-interval-seconds`: Poll interval while waiting, default `20`.
- `timeout-seconds`: Max wait time, default `900`.
- `repository-full-name`, `workflow-name`, `branch`, `head-sha`, `github-run-id`, `github-run-attempt`, `conclusion`:
  Optional metadata overrides. Defaults are auto-populated from GitHub Actions env.

## Outputs

- `status`: `created_execution` or `duplicate`.
- `execution-id`: Created/existing execution UUID.
- `execution-public-id`: Created/existing execution public id.
- `http-status`: HTTP status code (`200`, `409`, etc.).
- `idempotency-key`: Final key used by this request.
- `response-body`: Raw API response body.
- `final-status`: Terminal execution status (`completed/failed/cancelled`) when `wait-for-completion=true`.
- `final-outcome`: Terminal outcome (`passed/failed/cancelled`) when `wait-for-completion=true`.

## Idempotency Behavior

- First request with a key: usually `200` + `created_execution`
- Repeated request with same key: `409` + `duplicate`

This lets CI safely retry without creating duplicate runs.

## Wait For Final Result Example

```yaml
- name: Trigger and wait for DoableAI result
  uses: getdoable/run-test-action@v1
  with:
    trigger-token: ${{ secrets.DOABLEAI_TRIGGER_TOKEN }}
    group-id: 437062ea-6c73-46fe-9806-d766d49ec297
    wait-for-completion: true
    poll-interval-seconds: 20
    timeout-seconds: 1800
```

When final outcome is not `passed`, this step fails to make CI status visible in GitHub checks.

## Schedule Example

```yaml
- name: Trigger DoableAI schedule run
  uses: getdoable/run-test-action@v1
  with:
    trigger-token: ${{ secrets.DOABLEAI_TRIGGER_TOKEN }}
    schedule-id: 6bdf3cc8-9f96-4eef-bf7a-8f1d7e0ad67a
    idempotency-key: ${{ github.repository }}:${{ github.run_id }}:${{ github.run_attempt }}:nightly
```

## Smoke Workflow In This Repo

This repository includes `.github/workflows/e2e-smoke.yml` for end-to-end verification in GitHub Actions.

Configure these repository secrets before running it:

- `DOABLEAI_TRIGGER_TOKEN`
- one of:
  - `DOABLEAI_GROUP_ID`
  - `DOABLEAI_SCHEDULE_ID`

After each smoke run, check:

- job result (success/failure)
- step outputs
- `GITHUB_STEP_SUMMARY` (human-readable test result)
