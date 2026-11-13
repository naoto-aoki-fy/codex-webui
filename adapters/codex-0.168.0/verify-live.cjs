#!/usr/bin/env node
// Explicit opt-in real-provider verification. Never runs in credential-free CI.
const { WebSocket } = require('ws');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const opts = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(0, i), arg.slice(i + 1)]; }));
if (opts['--run-live'] !== 'true')
    throw Error('Pass --run-live=true to create disposable real-provider threads');
const ws = new WebSocket(opts['--server'] || 'ws://127.0.0.1:4500');
let seq = 0;
const pending = new Map();
const finished = new Map();
const waiters = new Map();
const owned = new Set();
const pendingOutcomes = new Map();
const report = { cases: [], sourcesUnchanged: true, archived: [], runtime: null };
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function rpc(method, params) { return new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(`RPC timeout: ${method}`)); }, 30000); pending.set(id, { resolve: x => { clearTimeout(timer); resolve(x); }, reject: x => { clearTimeout(timer); reject(x); } }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.on('message', raw => { const d = JSON.parse(raw); if (pending.has(d.id)) {
    const p = pending.get(d.id);
    pending.delete(d.id);
    d.error ? p.reject(Error(`RPC ${d.error.code}`)) : p.resolve(d.result);
    return;
} if (d.method === 'turn/completed' && owned.has(d.params.threadId)) {
    const { threadId, turn } = d.params;
    const result = { status: turn.status, turnId: turn.id, error: turn.error?.message };
    finished.set(threadId, result);
    if (pendingOutcomes.get(threadId) === turn.id)
        pendingOutcomes.delete(threadId);
    if (waiters.has(threadId)) {
        waiters.get(threadId)(result);
        waiters.delete(threadId);
    }
} });
async function turn(id, text, model) { finished.delete(id); pendingOutcomes.set(id, null); const ack = await rpc('turn/start', { threadId: id, input: [{ type: 'text', text }], model, effort: 'low' }); const acceptedId = ack.turn?.id; if (!acceptedId)
    throw Error('Missing accepted turn ID; outcome must be inspected'); pendingOutcomes.set(id, acceptedId); let result; try {
    result = await new Promise((resolve, reject) => { const timer = setTimeout(() => { waiters.delete(id); reject(Error('Turn outcome timeout')); }, 60000); const done = x => { clearTimeout(timer); resolve(x); }; if (finished.has(id))
        done(finished.get(id));
    else
        waiters.set(id, done); });
}
catch (error) {
    await rpc('turn/interrupt', { threadId: id, turnId: ack.turn?.id }).catch(() => { });
    throw error;
} if (result.turnId !== acceptedId)
    throw Error('Terminal notification did not match accepted turn'); pendingOutcomes.delete(id); return result; }
async function start(provider, model) { const r = await rpc('thread/start', { modelProvider: provider, model, cwd: '/tmp', approvalPolicy: 'never', sandbox: 'read-only', persistExtendedHistory: true }); owned.add(r.thread.id); if (r.model !== model || r.modelProvider !== provider)
    throw Error('Unconfirmed source provider/model'); return r.thread.id; }
const read = id => rpc('thread/read', { threadId: id, includeTurns: true });
const openai = opts['--openai-model'] || 'gpt-6-luna';
const qwen = opts['--custom-model'] || 'Qwen/Qwen3.6-35B-A3B';
const custom = opts['--custom-provider'] || 'rivault';
function requireComplete(result) { if (result.status !== 'completed')
    throw Error(`Turn failed (${result.status}); inspect structural adapter rejection logs`); }
async function exercise(source, target, cutoff, config, label, requireToolRoundTrip = true) {
    const before = await read(source.id);
    const prefix = before.thread.turns.slice(0, cutoff ? 1 : undefined);
    const fork = await rpc('thread/fork', { threadId: source.id, ...(cutoff ? { lastTurnId: prefix.at(-1).id } : {}), modelProvider: target.provider, model: target.model, persistExtendedHistory: true, ...(config ? { config } : {}) });
    const id = fork.thread.id;
    owned.add(id);
    if (fork.model !== target.model || fork.modelProvider !== target.provider)
        throw Error('Unconfirmed destination');
    const initial = await read(id);
    if (hash(initial.thread.turns) !== hash(prefix))
        throw Error('Fork history prefix differs');
    requireComplete(await turn(id, 'Reply exactly NATIVE_COMPAT_DESTINATION_READY. Do not use tools.', target.model));
    requireComplete(await turn(id, requireToolRoundTrip ? 'You must actually invoke the shell tool to read /proc/sys/kernel/random/uuid, then run printf NATIVE_COMPAT_TOOL_OK. Report the fresh UUID and marker only after receiving the tool result. Do not infer the output and do not modify files.' : 'Reply exactly NATIVE_COMPAT_CONTROL_SECOND. Do not use tools.', target.model));
    requireComplete(await turn(id, 'State the marker printed by the previous tool. Do not use tools.', target.model));
    const detail = await read(id);
    const added = detail.thread.turns.slice(prefix.length);
    const commands = added.flatMap(t => t.items).filter(i => i.type === 'commandExecution');
    const toolOutput = commands.filter(i => i.status === 'completed' && i.exitCode === 0).map(i => i.aggregatedOutput || '').join('\n');
    if (requireToolRoundTrip && (!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(toolOutput) || !toolOutput.includes('NATIVE_COMPAT_TOOL_OK')))
        throw Error('Missing actual tool execution/result evidence');
    const after = await read(source.id);
    if (hash(before.thread.turns) !== hash(after.thread.turns) || before.thread.model !== after.thread.model || before.thread.modelProvider !== after.thread.modelProvider)
        throw Error('Source history or provider/model was modified');
    const result = { label, cutoff, prefixTurns: prefix.length, destinationConfirmed: true, completedTurns: added.length, toolRoundTrip: requireToolRoundTrip ? true : null, sourceHash: hash(after.thread.turns), sourceUnchanged: true };
    report.cases.push(result);
    console.log(JSON.stringify(result));
    return id;
}
(async () => {
    if (ws.readyState !== WebSocket.OPEN)
        await new Promise(r => ws.once('open', r));
    const init = await rpc('initialize', { clientInfo: { name: 'native_projection_verification', version: '1' }, capabilities: { experimentalApi: true } });
    report.runtime = init.userAgent;
    ws.send(JSON.stringify({ method: 'initialized' }));
    const a = { provider: 'openai', model: openai, id: await start('openai', openai) };
    const b = { provider: custom, model: qwen, id: await start(custom, qwen) };
    for (const s of [a, b]) {
        requireComplete(await turn(s.id, 'Reply exactly NATIVE_COMPAT_SOURCE_READY. Do not use tools.', s.model));
        requireComplete(await turn(s.id, 'Reply exactly NATIVE_COMPAT_SOURCE_LATER. Do not use tools.', s.model));
    }
    // Include valid structured native tool history in the Qwen full fork.
    requireComplete(await turn(b.id, 'Actually use the shell tool to read /proc/sys/kernel/random/uuid and then printf NATIVE_COMPAT_SOURCE_TOOL. Do not infer the output or modify files.', b.model));
    const sourceTools = (await read(b.id)).thread.turns.flatMap(t => t.items).filter(i => i.type === 'commandExecution');
    if (!sourceTools.some(i => i.status === 'completed' && i.exitCode === 0 && (i.aggregatedOutput || '').includes('NATIVE_COMPAT_SOURCE_TOOL')))
        throw Error('Missing real structured tool history in source');
    const toCustom = { ['model_providers.' + custom + '.base_url']: 'http://127.0.0.1:4214/v1/' };
    const toOpenai = { openai_base_url: 'http://127.0.0.1:4213/backend-api/codex' };
    for (const cutoff of [false, true]) {
        await exercise(a, b, cutoff, toCustom, 'OpenAI to custom');
        await exercise(b, a, cutoff, toOpenai, 'Custom to OpenAI');
    }
    await exercise(a, a, false, null, 'OpenAI same-provider control', false);
    await exercise(b, b, false, null, 'Custom same-provider control', false);
    // Explicit synthetic negative fixture on a disposable child, never an assertion
    // that a real tool executed. The original source is not injected or rewritten.
    const prior = await read(a.id);
    const unsupported = await rpc('thread/fork', { threadId: a.id, modelProvider: b.provider, model: b.model, persistExtendedHistory: true, config: toCustom });
    owned.add(unsupported.thread.id);
    await rpc('thread/inject_items', {threadId:unsupported.thread.id,items:[
        {type:'additional_tools',role:'developer',tools:[{type:'custom',name:'audit_unregistered_custom',format:{type:'text'}}]},
        {type:'custom_tool_call',call_id:'audit_custom_call',name:'audit_unregistered_custom',input:'Synthetic audit fixture; no tool execution'},
        {type:'custom_tool_call_output',call_id:'audit_custom_call',output:'Synthetic audit fixture output'}
    ]});
    const rejection = await turn(unsupported.thread.id, 'Reply exactly NATIVE_COMPAT_UNSUPPORTED_DESTINATION. Do not use tools.', b.model);
    if (rejection.status !== 'failed' || !rejection.error?.includes('custom-to-function'))
        throw Error('Expected explicit unsupported custom conversion');
    if (hash(prior.thread.turns) !== hash((await read(a.id)).thread.turns))
        throw Error('Unsupported conversion modified source');
    report.unsupportedCustomConversion = { syntheticFixture: true, rejected: true, sourceUnchanged: true };

})().catch(error => { report.failure = error.message; process.exitCode = 1; console.error(error.message); }).finally(async () => { for (const id of owned) {
    try {
        if (pendingOutcomes.has(id)) {
            const snapshot = await read(id);
            const acceptedId = pendingOutcomes.get(id);
            const terminal = snapshot.thread.turns.find(t => t.id === acceptedId && ['completed', 'failed', 'interrupted'].includes(t.status));
            if (!terminal) {
                (report.unconfirmedOutcomes ||= []).push(id);
                process.exitCode = 1;
                continue;
            }
        }
        await rpc('thread/archive', { threadId: id });
        report.archived.push(id);
    }
    catch {
        report.cleanupFailure = true;
        process.exitCode = 1;
    }
} fs.writeFileSync(opts['--report'] || '/tmp/native-projection-verification.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ cases: report.cases.length, archived: report.archived.length, failure: report.failure || null })); ws.close(); });
