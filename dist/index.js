"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const TRIGGER_API_URL = 'https://api.doableai.com/api/integrations/github/trigger-run';
const EXECUTION_STATUS_API_URL = 'https://api.doableai.com/api/integrations/github/execution-status';
function readInput(name, required = false) {
    // GitHub Actions maps action inputs to env vars by replacing spaces only.
    // Keep both keys to be resilient across runner/tooling differences.
    const officialEnvKey = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
    const normalizedEnvKey = `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
    const value = process.env[officialEnvKey] || process.env[normalizedEnvKey] || '';
    const trimmed = value.trim();
    if (required && !trimmed) {
        throw new Error(`Missing required input: ${name}`);
    }
    return trimmed;
}
function setOutput(name, value) {
    if (!process.env.GITHUB_OUTPUT)
        return;
    const output = String(value ?? '');
    node_fs_1.default.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<__DOABLEAI_EOF__\n${output}\n__DOABLEAI_EOF__\n`);
}
function parseBooleanInput(value) {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
function parsePositiveIntegerInput(value, fallback) {
    const trimmed = value.trim();
    if (!trimmed)
        return fallback;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed <= 0)
        return fallback;
    return parsed;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function buildDefaultIdempotencyKey({ repositoryFullName, workflowName, headSha, githubRunId, githubRunAttempt, groupPublicId, }) {
    return [
        repositoryFullName || 'unknown-repo',
        workflowName || 'unknown-workflow',
        headSha || 'unknown-sha',
        githubRunId || 'unknown-run',
        githubRunAttempt || '1',
        groupPublicId || 'unknown-group-public-id',
    ].join(':');
}
function maybeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function buildExecutionStatusUrl(baseUrl, executionPublicId) {
    const url = new URL(baseUrl);
    url.searchParams.set('execution_public_id', executionPublicId);
    return url.toString();
}
function normalizeOutcome(value) {
    if (value === 'passed' || value === 'failed' || value === 'cancelled') {
        return value;
    }
    return 'pending';
}
async function run() {
    const apiKey = readInput('api-key', true);
    const groupPublicId = readInput('group-public-id', true);
    const waitForCompletion = parseBooleanInput(readInput('wait-for-completion'));
    const pollIntervalSeconds = parsePositiveIntegerInput(readInput('poll-interval-seconds'), 20);
    const timeoutSeconds = parsePositiveIntegerInput(readInput('timeout-seconds'), 1800);
    const repositoryFullName = process.env.GITHUB_REPOSITORY || '';
    const workflowName = process.env.GITHUB_WORKFLOW || '';
    const branch = process.env.GITHUB_REF_NAME || '';
    const headSha = process.env.GITHUB_SHA || '';
    const githubRunId = process.env.GITHUB_RUN_ID || '';
    const githubRunAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
    const conclusion = process.env.GITHUB_JOB_STATUS || undefined;
    const idempotencyKey = readInput('idempotency-key') ||
        buildDefaultIdempotencyKey({
            repositoryFullName,
            workflowName,
            headSha,
            githubRunId,
            githubRunAttempt,
            groupPublicId,
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
            group_public_id: groupPublicId,
        },
    };
    console.log(`Triggering DoableAI API: ${TRIGGER_API_URL}`);
    console.log(`Target group public id: ${groupPublicId}`);
    console.log(`Idempotency key: ${idempotencyKey}`);
    const response = await fetch(TRIGGER_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Idempotency-Key': idempotencyKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const responseBody = await response.text();
    const parsed = maybeJson(responseBody);
    if (parsed) {
        if (typeof parsed.outcome_url === 'string') {
            setOutput('outcome-link', parsed.outcome_url);
        }
    }
    if (response.status === 200 || response.status === 409) {
        const statusText = parsed && typeof parsed.status === 'string' ? parsed.status : `http_${response.status}`;
        console.log(`DoableAI trigger accepted with status: ${statusText}`);
    }
    else {
        throw new Error(`Trigger API failed with status ${response.status}: ${responseBody}`);
    }
    if (!waitForCompletion) {
        setOutput('status', 'accepted');
        setOutput('outcome', 'pending');
        return;
    }
    const executionPublicId = parsed && typeof parsed.execution_public_id === 'string'
        ? parsed.execution_public_id
        : null;
    if (!executionPublicId) {
        throw new Error('wait-for-completion=true requires execution_public_id in trigger response.');
    }
    const triggerOutcomeUrl = parsed && typeof parsed.outcome_url === 'string' ? parsed.outcome_url : null;
    if (triggerOutcomeUrl) {
        setOutput('outcome-link', triggerOutcomeUrl);
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    const pollUrl = buildExecutionStatusUrl(EXECUTION_STATUS_API_URL, executionPublicId);
    while (true) {
        const statusResponse = await fetch(pollUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
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
        const outcomeRaw = typeof parsedStatusBody.outcome === 'string' ? parsedStatusBody.outcome : null;
        const outcome = normalizeOutcome(outcomeRaw);
        const isTerminal = parsedStatusBody.is_terminal === true;
        if (typeof parsedStatusBody.outcome_url === 'string') {
            setOutput('outcome-link', parsedStatusBody.outcome_url);
        }
        console.log(`Execution polled: outcome=${outcome}, terminal=${isTerminal}`);
        if (isTerminal) {
            setOutput('status', 'completed');
            setOutput('outcome', outcome);
            if (outcome === 'passed') {
                return;
            }
            throw new Error(`DoableAI execution finished with outcome: ${outcome}`);
        }
        if (Date.now() >= deadline) {
            setOutput('status', 'timeout');
            setOutput('outcome', 'timeout');
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
