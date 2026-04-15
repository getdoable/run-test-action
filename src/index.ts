import fs from 'node:fs';

function readInput(name: string, required = false): string {
  const envKey = `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
  const value = process.env[envKey] || '';
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new Error(`Missing required input: ${name}`);
  }
  return trimmed;
}

function setOutput(name: string, value: unknown): void {
  if (!process.env.GITHUB_OUTPUT) return;
  const output = String(value ?? '');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<__DOABLEAI_EOF__\n${output}\n__DOABLEAI_EOF__\n`);
}

function parseBooleanInput(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveIntegerInput(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface IdempotencyBuildInput {
  repositoryFullName: string;
  workflowName: string;
  headSha: string;
  githubRunId: string;
  githubRunAttempt: string;
  targetType: 'group' | 'schedule';
  targetId: string;
}

function buildDefaultIdempotencyKey({
  repositoryFullName,
  workflowName,
  headSha,
  githubRunId,
  githubRunAttempt,
  targetType,
  targetId,
}: IdempotencyBuildInput): string {
  return [
    repositoryFullName || 'unknown-repo',
    workflowName || 'unknown-workflow',
    headSha || 'unknown-sha',
    githubRunId || 'unknown-run',
    githubRunAttempt || '1',
    targetType,
    targetId || 'unknown-target',
  ].join(':');
}

function maybeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildExecutionStatusUrl(baseUrl: string, executionId: string | null, executionPublicId: string | null): string {
  const url = new URL(baseUrl);
  if (executionId) {
    url.searchParams.set('execution_id', executionId);
  } else if (executionPublicId) {
    url.searchParams.set('execution_public_id', executionPublicId);
  }
  return url.toString();
}

async function run(): Promise<void> {
  const triggerApiUrl = readInput('trigger-api-url', true);
  const executionStatusApiUrl = readInput('execution-status-api-url');
  const triggerToken = readInput('trigger-token', true);
  const waitForCompletion = parseBooleanInput(readInput('wait-for-completion'));
  const pollIntervalSeconds = parsePositiveIntegerInput(readInput('poll-interval-seconds'), 20);
  const timeoutSeconds = parsePositiveIntegerInput(readInput('timeout-seconds'), 900);
  const groupId = readInput('group-id');
  const scheduleId = readInput('schedule-id');
  const conclusion = readInput('conclusion');

  const targetCount = Number(Boolean(groupId)) + Number(Boolean(scheduleId));
  if (targetCount !== 1) {
    throw new Error('Exactly one of "group-id" or "schedule-id" must be provided.');
  }

  const repositoryFullName = readInput('repository-full-name') || process.env.GITHUB_REPOSITORY || '';
  const workflowName = readInput('workflow-name') || process.env.GITHUB_WORKFLOW || '';
  const branch = readInput('branch') || process.env.GITHUB_REF_NAME || '';
  const headSha = readInput('head-sha') || process.env.GITHUB_SHA || '';
  const githubRunId = readInput('github-run-id') || process.env.GITHUB_RUN_ID || '';
  const githubRunAttempt = readInput('github-run-attempt') || process.env.GITHUB_RUN_ATTEMPT || '1';
  const targetType: 'group' | 'schedule' = groupId ? 'group' : 'schedule';
  const targetId = groupId || scheduleId;

  const idempotencyKey =
    readInput('idempotency-key') ||
    buildDefaultIdempotencyKey({
      repositoryFullName,
      workflowName,
      headSha,
      githubRunId,
      githubRunAttempt,
      targetType,
      targetId,
    });

  const parsedRunAttempt = Number.parseInt(githubRunAttempt, 10);
  const body = {
    repository_full_name: repositoryFullName || undefined,
    workflow_name: workflowName || undefined,
    branch: branch || undefined,
    head_sha: headSha || undefined,
    github_run_id: githubRunId || undefined,
    github_run_attempt: Number.isNaN(parsedRunAttempt) ? undefined : parsedRunAttempt,
    conclusion: conclusion || undefined,
    target: {
      group_id: groupId || undefined,
      schedule_id: scheduleId || undefined,
    },
  };

  console.log(`Triggering DoableAI API: ${triggerApiUrl}`);
  console.log(`Target type: ${targetType}`);
  console.log(`Idempotency key: ${idempotencyKey}`);

  const response = await fetch(triggerApiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${triggerToken}`,
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  const parsed = maybeJson(responseBody);

  setOutput('http-status', String(response.status));
  setOutput('idempotency-key', idempotencyKey);
  setOutput('response-body', responseBody);

  if (parsed) {
    if (typeof parsed.status === 'string') setOutput('status', parsed.status);
    if (typeof parsed.execution_id === 'string') setOutput('execution-id', parsed.execution_id);
    if (typeof parsed.execution_public_id === 'string') {
      setOutput('execution-public-id', parsed.execution_public_id);
    }
  }

  if (response.status === 200 || response.status === 409) {
    const statusText = parsed && typeof parsed.status === 'string' ? parsed.status : `http_${response.status}`;
    console.log(`DoableAI trigger accepted with status: ${statusText}`);
  } else {
    throw new Error(`Trigger API failed with status ${response.status}: ${responseBody}`);
  }

  if (!waitForCompletion) {
    return;
  }

  const executionId = parsed && typeof parsed.execution_id === 'string' ? parsed.execution_id : null;
  const executionPublicId = parsed && typeof parsed.execution_public_id === 'string' ? parsed.execution_public_id : null;
  if (!executionId && !executionPublicId) {
    throw new Error('wait-for-completion=true requires execution_id or execution_public_id in trigger response.');
  }

  const finalStatusApiUrl = executionStatusApiUrl || triggerApiUrl.replace(/\/trigger-run\/?$/, '/execution-status');
  const deadline = Date.now() + timeoutSeconds * 1000;
  const pollUrl = buildExecutionStatusUrl(finalStatusApiUrl, executionId, executionPublicId);

  while (true) {
    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${triggerToken}`,
        'Content-Type': 'application/json',
      },
    });
    const statusBody = await statusResponse.text();
    const parsedStatusBody = maybeJson(statusBody);

    if (!statusResponse.ok) {
      throw new Error(`Execution status API failed with status ${statusResponse.status}: ${statusBody}`);
    }
    if (!parsedStatusBody || parsedStatusBody.status !== 'ok') {
      throw new Error(`Unexpected execution status payload: ${statusBody}`);
    }

    const execution = parsedStatusBody.execution as Record<string, unknown> | undefined;
    const latestStatus = typeof execution?.status === 'string' ? execution.status : '';
    const outcome = typeof parsedStatusBody.outcome === 'string' ? parsedStatusBody.outcome : '';
    const isTerminal = parsedStatusBody.is_terminal === true;

    setOutput('final-status', latestStatus);
    setOutput('final-outcome', outcome);
    console.log(`Execution polled: status=${latestStatus || 'unknown'}, outcome=${outcome || 'unknown'}, terminal=${isTerminal}`);

    if (isTerminal) {
      if (outcome === 'passed') {
        return;
      }
      throw new Error(`DoableAI execution finished with outcome: ${outcome || 'unknown'}`);
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for DoableAI execution result after ${timeoutSeconds}s`);
    }

    await sleep(pollIntervalSeconds * 1000);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
