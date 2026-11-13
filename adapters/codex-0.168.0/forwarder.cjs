#!/usr/bin/env node
// Explicit audit/deployment adapter, never started by codexapp. Bodies and headers
// stay in memory. Logs contain structural metadata only, never tool/prompt text.
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomUUID } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');
const zstd = require('@bokuweb/zstd-wasm');
const zlib = require('node:zlib');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(0, i), arg.slice(i + 1)]; }));
if (process.argv.includes('--help')) {
    console.log('Responses compatibility adapter: --port=N --upstream=URL --policy=JSON --project=true|false [--binary=PATH]. Binds localhost; does not change Codex configuration.');
    process.exit(0);
}
const port = Number(args['--port']);
const upstream = new URL(args['--upstream']);
const policy = JSON.parse(args['--policy']);
const enabled = args['--project'] === 'true';
const child = enabled ? spawn(args['--binary'], [], { stdio: ['pipe', 'pipe', 'inherit'] }) : null;
const pending = [];
let projectorFailed = false;
if (child) {
    createInterface({ input: child.stdout }).on('line', line => { const task = pending.shift(); if (task) {
        try {
            task.resolve(JSON.parse(line));
        }
        catch {
            task.reject(Error('Invalid projection response'));
        }
    } });
    const fail = () => { projectorFailed = true; pending.splice(0).forEach(task => task.reject(Error('Projection process unavailable'))); };
    child.on('exit', fail);
    child.on('error', fail);
    child.stdin.on('error', fail);
}
const project = request => !enabled ? Promise.resolve({ request, stats: { unchanged: true } }) : new Promise((resolve, reject) => { if (projectorFailed || pending.length >= 8) {
    reject(Error('Projection process unavailable or busy'));
    return;
} pending.push({ resolve, reject }); child.stdin.write(JSON.stringify({ destination: policy, request }) + '\n'); });
function structure(request) { return { model: request.model, input: (request.input || []).map((item, index) => ({ index, type: item.type, fields: Object.keys(item).sort(), content: Array.isArray(item.content) ? { length: item.content.length, types: item.content.map(c => c.type) } : typeof item.content })), toolsCount: Array.isArray(request.tools) ? request.tools.length : 0 }; }
function headers(source) { return Object.fromEntries(Object.entries(source).filter(([key]) => !['host', 'connection', 'upgrade', 'content-length', 'content-encoding', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol'].includes(key))); }
function target(path, websocket = false) { const url = new URL(upstream); const request = new URL(path, 'http://localhost'); url.pathname = request.pathname; url.search = request.search; if (websocket)
    url.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:'; return url; }
function errorMetadata(value) { const e = value.error || value; return { type: e.type, code: e.code, param: e.param, status: value.status }; }
function log(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function transform(request, trace) { if (!Array.isArray(request.input))
    return request; log({ event: 'request', trace, before: structure(request) }); const result = await project(request); if (result.error)
    throw Error(result.error); log({ event: 'projection', trace, stats: result.stats, after: structure(result.request) }); return result.request; }
const server = http.createServer(async (req, res) => {
    const trace = randomUUID();
    let chunks = [];
    let size = 0;
    try {
        for await (const chunk of req) {
            size += chunk.length;
            if (size > 32 * 1024 * 1024)
                throw Error('Request exceeds adapter limit');
            chunks.push(chunk);
        }
        let body = Buffer.concat(chunks);
        if (req.headers['content-encoding'] === 'zstd')
            body = Buffer.from(zstd.decompress(body));
        else if (req.headers['content-encoding'] === 'gzip')
            body = zlib.gunzipSync(body);
        if (body.length > 32 * 1024 * 1024)
            throw Error('Decoded request exceeds adapter limit');
        if (body.length && req.url.includes('/responses')) {
            let parsed;
            try {
                parsed = JSON.parse(body.toString());
            }
            catch {
                throw Error('Invalid Responses JSON; contents not logged');
            }
            body = Buffer.from(JSON.stringify(await transform(parsed, trace)));
        }
        const url = target(req.url);
        const send = url.protocol === 'https:' ? https : http;
        const remote = send.request(url, { method: req.method, headers: { ...headers(req.headers), ...(body.length ? { 'content-length': body.length } : {}), 'x-client-request-id': trace } }, response => {
            log({ event: 'upstream', trace, status: response.statusCode, requestId: response.headers['x-request-id'] });
            res.writeHead(response.statusCode, response.headers);
            if ((response.statusCode || 0) >= 400) {
                let error = [];
                response.on('data', c => error.push(c));
                response.on('end', () => { const raw = Buffer.concat(error); try {
                    log({ event: 'rejection', trace, ...errorMetadata(JSON.parse(raw.toString())) });
                }
                catch { } res.end(raw); });
            }
            else
                response.pipe(res);
        });
        remote.on('error', () => { log({ event: 'transport_error', trace }); if (!res.headersSent)
            res.writeHead(502); res.end('Upstream transport error'); });
        remote.end(body);
    }
    catch (error) {
        log({ event: 'unsupported_projection', trace, message: error.message });
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'unsupported_history_projection', message: error.message + '. Choose a compatible destination; stored history was not modified.' } }));
    }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, client => {
    const remote = new WebSocket(target(req.url, true), { headers: headers(req.headers) });
    let chain = Promise.resolve();
    let trace = '';
    const ready = new Promise((resolve, reject) => { remote.once('open', resolve); remote.once('error', reject); });
    client.on('message', raw => { chain = chain.then(async () => { await ready; let request; try {
        request = JSON.parse(raw.toString());
    }
    catch {
        throw Error('Invalid WebSocket JSON; contents not logged');
    } trace = randomUUID(); const projected = await transform(request, trace); remote.send(JSON.stringify(projected)); }).catch(error => { log({ event: 'unsupported_projection', trace, message: error.message }); if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify({ type: 'error', status: 400, error: { type: 'unsupported_history_projection', message: error.message + '. Choose a compatible destination; stored history was not modified.' } })); }); });
    remote.on('message', raw => { try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'error')
            log({ event: 'rejection', trace, ...errorMetadata(data) });
        if (data.type === 'response.completed')
            log({ event: 'completed', trace, responseId: data.response?.id });
    }
    catch { } if (client.readyState === WebSocket.OPEN)
        client.send(raw.toString()); });
    remote.on('unexpected-response', (_request, response) => { log({ event: 'handshake_rejected', status: response.statusCode }); response.resume(); if (client.readyState === WebSocket.OPEN)
        client.close(1011, 'Upstream handshake rejected'); });
    remote.on('error', () => { log({ event: 'transport_error', trace }); if (client.readyState === WebSocket.OPEN)
        client.close(1011, 'Upstream transport error'); });
    client.on('close', () => remote.close());
    remote.on('close', () => client.close());
}));
(async () => { await zstd.init(); server.listen(port, '127.0.0.1', () => log({ event: 'ready', port, enabled })); })();
function stop() { for (const c of wss.clients)
    c.terminate(); wss.close(); server.close(); child?.kill(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
