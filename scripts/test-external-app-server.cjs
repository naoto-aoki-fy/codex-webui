const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { createServer } = require('node:http')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { WebSocketServer, WebSocket } = require('ws')

async function run() {
  const unix = process.env.CODEXAPP_FIXTURE_TRANSPORT === 'unix'
  if (unix && process.platform === 'win32') throw new Error('Unix fixture requires Linux/macOS')
  const directory = unix ? mkdtempSync(join(tmpdir(), 'uds-fixture-')) : null
  const path = directory ? join(directory, 'codex.sock') : null
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  if (path) http.listen(path)
  else http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const endpoint = path ? 'unix://' + path : 'ws://127.0.0.1:' + http.address().port
  const frames = []
  let connections = 0
  server.on('connection', socket => {
    connections++
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw)); frames.push(frame)
      if (!frame.method || frame.method === 'initialized') return
      if (frame.method === 'model/list') {
        assert.equal(frame.params.modelProvider, 'fixture-provider')
        assert.equal(frame.params.includeHidden, true)
      }
      const result = frame.method === 'account/read' ? { account: { type: 'apiKey' } }
        : frame.method === 'modelProvider/list' ? { data: [{ id: 'fixture-provider', displayName: 'Fixture', isDefault: true }] }
        : frame.method === 'model/list' ? { data: [{ id: frame.params.cursor ? 'fixture-hidden' : 'fixture-model', hidden: Boolean(frame.params.cursor), isDefault: !frame.params.cursor }], nextCursor: frame.params.cursor ? null : 'fixture-next' }
        : frame.method === 'thread/list' ? { data: [], nextCursor: null } : {}
      socket.send(JSON.stringify({ id: frame.id, result }))
    })
  })
  try {
    for (const dev of [false, true]) {
      const port = dev ? 4199 : 4198
      // Codex is absent on this host; CLI precedence deliberately overrides a refused env URL.
      const child = spawn(dev ? 'pnpm' : process.execPath, dev
        ? ['run', 'dev', '--host', '127.0.0.1', '--port', String(port)]
        : ['dist-cli/index.js', '--host', '127.0.0.1', '--port', String(port), '--no-open', '--app-server-url', endpoint], {
        env: { ...process.env, CODEXUI_APP_SERVER_URL: dev ? endpoint : 'ws://127.0.0.1:1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      let output = ''
      child.stdout.on('data', data => { output += data })
      child.stderr.on('data', data => { output += data })
      try {
        const url = 'http://127.0.0.1:' + port
        let ready = false
        for (let i = 0; i < 150; i++) {
          try { if ((await fetch(url)).ok) { ready = true; break } } catch {}
          if (child.exitCode !== null) throw new Error(output)
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        assert(ready, output)
        for (const path of ['/codex-api/git/repository-status', '/codex-api/prompts', '/codex-api/thread-titles', '/codex-api/worktree/create', '/codex-api/worktree/branches', '/codex-api/thread/rollback-files', '/codex-api/github-clone', '/codex-api/local-directory', '/codex-api/projectless-thread-cwd', '/codex-api/project-root-suggestion', '/codex-api/telegram/config', '/codex-api/telegram/configure-bot', '/codex-api/telegram/status', '/codex-api/telegram/test-notification', '/codex-api/worktree/create-permanent', '/codex-api/thread-file-change-fallback', '/codex-api/thread-live-state', '/codex-api/thread-stream-events']) {
          for (const method of ['GET', 'HEAD', 'POST']) {
            for (const query of ['', '?threadId=fixture-thread']) {
              const retired = await fetch(url + path + query, { method })
              assert.equal(retired.status, 404)
              assert.match(retired.headers.get('content-type'), /application\/json/)
              if (method === 'HEAD') assert.equal(await retired.text(), '')
              else assert.deepEqual(await retired.json(), { error: 'Not found' })
            }
          }
          console.log('PASS', dev ? 'pnpm run dev' : 'built CLI', path, 'returns JSON 404')
        }
        const before = connections
        for (const method of ['account/read', 'modelProvider/list', 'model/list', 'thread/list']) {
          const response = await fetch(url + '/codex-api/rpc', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method, params: method === 'model/list' ? { modelProvider: 'fixture-provider', includeHidden: true } : {} }),
          })
          const body = await response.json()
          assert(response.ok && body.result, JSON.stringify(body))
          if (method === 'modelProvider/list') assert.equal(body.result.data[0].id, 'fixture-provider')
          if (method === 'model/list') {
            assert.equal(body.result.data[0].id, 'fixture-model')
            assert.equal(body.result.nextCursor, 'fixture-next')
            const next = await fetch(url + '/codex-api/rpc', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ method, params: { modelProvider: 'fixture-provider', includeHidden: true, cursor: body.result.nextCursor } }),
            })
            assert(next.ok)
            assert.deepEqual((await next.json()).result, { data: [{ id: 'fixture-hidden', hidden: true, isDefault: false }], nextCursor: null })
          }
        }
        const metadata = await (await fetch(url + '/codex-api/meta/methods')).json()
        assert(JSON.stringify(metadata).includes('thread/start'))
        const ws = new WebSocket(url.replace('http:', 'ws:') + '/codex-api/ws')
        const [raw] = await once(ws, 'message', { signal: AbortSignal.timeout(5000) })
        assert.equal(JSON.parse(String(raw)).method, 'ready')
        ws.terminate()
        assert.equal(connections - before, 1)
        console.log('PASS', dev ? 'pnpm run dev' : 'built CLI', 'HTTP RPC, metadata, browser WS; one upstream connection')
      } finally {
        const exited = once(child, 'exit')
        process.kill(-child.pid, 'SIGTERM')
        await exited
        assert(server.address(), 'fixture listener survives web shutdown')
      }
    }
    assert(!frames.some(f => f.method === 'command/exec' || f.method === 'model/providerCatalog'))
    assert.equal(frames.filter(f => f.method === 'initialize').length, connections)
    console.log('PASS initialization count:', connections, '; independent fixture listener survives both shutdowns')
  } finally {
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => http.close(resolve))
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
