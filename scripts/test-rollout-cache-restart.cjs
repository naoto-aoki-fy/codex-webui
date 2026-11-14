// A fresh Node process must reuse the cache written by the live acceptance test.
const WebSocket = require('ws')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { RolloutGenerationMetadata } = require(process.argv[2])
const f = JSON.parse(readFileSync(process.argv[3], 'utf8'))
;(async () => {
  const ws = new WebSocket(process.env.CODEXUI_APP_SERVER_URL || 'ws://127.0.0.1:4500')
  const pending = new Map(); let id = 0, sourceReads = 0
  ws.on('message', raw => {
    const frame = JSON.parse(String(raw)), p = pending.get(frame.id)
    if (p) { pending.delete(frame.id); clearTimeout(p.timer); frame.error ? p.reject(Object.assign(new Error(frame.error.message), frame.error)) : p.resolve(frame.result) }
  })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (method === 'fs/readFile' && params.path === f.path) sourceReads++
    const n = ++id, timer = setTimeout(() => reject(new Error('RPC timed out')), 15000)
    pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params }))
  })
  try {
    const init = await rpc('initialize', { clientInfo: { name: 'rollout-cache-restart-check', version: '1' }, capabilities: { experimentalApi: true } })
    ws.send(JSON.stringify({ method: 'initialized' }))
    const result = await new RolloutGenerationMetadata({ rpc, generation: () => 1, home: () => init.codexHome }).recover(f.threadId)
    assert.equal(result.size, f.turns)
    assert.equal(sourceReads, 0)
    console.log(JSON.stringify({ freshProcess: true, turns: result.size, sourceReads }))
  } finally { ws.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
