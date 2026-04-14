"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
function readInput(name, required = false) {
    const envKey = `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
    const value = process.env[envKey] || '';
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
function buildDefaultIdempotencyKey({ repositoryFullName, workflowName, headSha, githubRunId, githubRunAttempt, targetType, targetId, }) {
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
function maybeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
async function run() {
    const triggerApiUrl = readInput('trigger-api-url', true);
    const triggerToken = readInput('trigger-token', true);
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
    const targetType = groupId ? 'group' : 'schedule';
    const targetId = groupId || scheduleId;
    const idempotencyKey = readInput('idempotency-key') ||
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
        if (typeof parsed.status === 'string')
            setOutput('status', parsed.status);
        if (typeof parsed.execution_id === 'string')
            setOutput('execution-id', parsed.execution_id);
        if (typeof parsed.execution_public_id === 'string') {
            setOutput('execution-public-id', parsed.execution_public_id);
        }
    }
    if (response.status === 200 || response.status === 409) {
        const statusText = parsed && typeof parsed.status === 'string' ? parsed.status : `http_${response.status}`;
        console.log(`DoableAI trigger accepted with status: ${statusText}`);
        return;
    }
    throw new Error(`Trigger API failed with status ${response.status}: ${responseBody}`);
}
run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
