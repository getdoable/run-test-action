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
        uses: getdoable/run-test-action@main
        with:
          api-key: ${{ secrets.DOABLEAI_API_KEY }}
          group-public-id: tg-gqxhqski
          wait-for-completion: true
```

## Inputs

- `api-key` (**required**): DoableAI API key created in DoableAI Settings -> API Keys.
- `group-public-id` (**required**): Regression group public id (for example: `tg-xxxx`).
- `idempotency-key`: Optional dedupe key. If omitted, action auto-generates one from GitHub context.
- `wait-for-completion`: `true/false`, default `true`. When `true`, action polls until terminal result.
- `poll-interval-seconds`: Poll interval while waiting, default `20`.
- `timeout-seconds`: Max wait time, default `900`.

## Outputs

- `status`: Action lifecycle status (`accepted`, `completed`, `timeout`).
- `outcome`: Execution outcome (`pending`, `passed`, `failed`, `cancelled`, `timeout`).
- `outcome-link`: URL of the DoableAI run result page.

## Idempotency Behavior

- First request with a key usually creates a new execution.
- Repeated request with the same key returns the existing execution.

This lets CI safely retry without creating duplicate runs.

## Wait For Final Result Example

```yaml
- name: Trigger and wait for DoableAI result
  uses: getdoable/run-test-action@main
  with:
    api-key: ${{ secrets.DOABLEAI_API_KEY }}
    group-public-id: tg-gqxhqski
    wait-for-completion: true
    poll-interval-seconds: 20
    timeout-seconds: 1800
```

When final outcome is not `passed`, this step fails to make CI status visible in GitHub checks.

## Smoke Workflow In This Repo

This repository includes `.github/workflows/e2e-smoke.yml` for end-to-end verification in GitHub Actions.

Configure these repository secrets before running it:

- `DOABLEAI_API_KEY`
- `DOABLEAI_GROUP_PUBLIC_ID`

After each smoke run, check:

- job result (success/failure)
- step outputs
- `GITHUB_STEP_SUMMARY` (human-readable test result)
