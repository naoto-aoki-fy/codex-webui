const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { createServer } = require('node:http')
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { WebSocketServer, WebSocket } = require('ws')
const { fixtureWebuiStorage } = require('./fixture-webui-storage.cjs')

async function run() {
  const unix = process.env.CODEXAPP_FIXTURE_TRANSPORT === 'unix'
  if (unix && process.platform === 'win32') throw new Error('Unix fixture requires Linux/macOS')
  const directory = mkdtempSync(join(tmpdir(), 'webui-app-server-fixture-'))
  const path = unix ? join(directory, 'codex.sock') : null
  const { profileDirectoryName, resolveWebuiStorage } = await import('../src/server/webuiStorage.mjs')
  const storageEnv = fixtureWebuiStorage(directory, 'fixture-vite')
  const oldFiles = {
    'config.toml': '# native sentinel',
    '.codex-global-state.json': '{"legacy":true}',
    'codexapp-model-preferences.json': '{"schemaVersion":1,"preferred":{"modelId":"old"}}',
  }
  mkdirSync(storageEnv.CODEX_HOME)
  for (const [name, raw] of Object.entries(oldFiles)) writeFileSync(join(storageEnv.CODEX_HOME, name), raw)
  const files = new Map()
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  if (path) http.listen(path)
  else http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const endpoint = path ? 'unix://' + path : 'ws://127.0.0.1:' + http.address().port
  const frames = []
  const historyId = 'history-cursor-fixture'
  const historyTurns = Array.from({ length: 15 }, (_, index) => ({ id: 'turn-' + index, items: [] }))
  const olderCursor = 'native-opaque-cursor'
  let connections = 0
  server.on('connection', socket => {
    connections++
    let metadataFixtureRead=false
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw)); frames.push(frame)
      if (!frame.method || frame.method === 'initialized') return
      if(frame.method==='thread/read'&&frame.params?.threadId==='metadata-status-fixture'){
        const reply=metadataFixtureRead?{error:{code:-32603,message:'failed to read thread: rollout at /fixture/rollout.jsonl is empty'}}:{result:{thread:{id:'metadata-status-fixture',cwd:'/fixture',status:{type:'idle'},turns:[]}}}
        metadataFixtureRead=true;socket.send(JSON.stringify({id:frame.id,...reply}));return
      }
      if (frame.method === 'command/exec' || frame.method === 'command/exec/terminate' || frame.method === 'account/usage/read' || frame.method === 'account/login/start' || frame.method === 'account/login/cancel' || frame.method === 'thread/compact/start' || frame.method === 'thread/delete' || frame.method === 'review/start' || frame.method.startsWith('thread/queue/') || frame.method === 'thread/settings/update' || frame.method === 'config/value/write' || frame.method === 'maintenance/unknown' || frame.method === 'generate-thread-title') {
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Method not found' } }))
        return
      }
      if (frame.method === 'model/list') {
        assert.equal(frame.params.modelProvider, 'fixture-provider')
        assert.equal(frame.params.includeHidden, true)
      }
      if (frame.method === 'fs/writeFile') files.set(frame.params.path, Buffer.from(frame.params.dataBase64, 'base64'))
      const result = frame.method === 'initialize' ? { codexHome: '/fixture/core' }
        : frame.method === 'fs/getMetadata' ? { isDirectory: true, isSymlink: false }
        : frame.method === 'thread/name/set' ? {}
        : frame.method === 'account/read' ? { account: { type: 'apiKey', apiKey: 'fixture-secret' }, requiresOpenaiAuth: true, authToken: 'fixture-secret' }
        : frame.method === 'modelProvider/list' ? { data: [{ id: 'fixture-provider', displayName: 'Fixture', isDefault: true }] }
        : frame.method === 'model/list' ? { data: [{ id: frame.params.cursor ? 'fixture-hidden' : 'fixture-model', hidden: Boolean(frame.params.cursor), isDefault: !frame.params.cursor }], nextCursor: frame.params.cursor ? null : 'fixture-next' }
        : ['thread/list', 'project/list'].includes(frame.method) ? { data: [], nextCursor: null }
        : frame.method === 'thread/read' && frame.params.threadId === historyId ? { thread: { id: historyId, turns: [] } }
        : frame.method === 'thread/turns/list' && frame.params.threadId === historyId
          ? { data: frame.params.cursor ? historyTurns.slice(0, 5).reverse() : historyTurns.slice(5).reverse(), nextCursor: frame.params.cursor ? null : olderCursor }
          : {}
      socket.send(JSON.stringify({ id: frame.id, result }))
    })
  })
  try {
    for (const [command, args] of [[process.execPath, ['dist-cli/index.js', '--no-open']], ['pnpm', ['run', 'dev']]]) {
      for (const [profile, error] of [[undefined, /App Server ID is required/], ['../outside', /Invalid App Server ID/]]) {
        const env = { ...process.env, ...storageEnv }
        if (profile === undefined) delete env.CODEXUI_CONNECTION_PROFILE
        else env.CODEXUI_CONNECTION_PROFILE = profile
        const invalid = spawnSync(command, args, { env, encoding: 'utf8', timeout: 20_000 })
        assert.equal(invalid.status, 1)
        assert.match(invalid.stderr, error)
        console.log('PASS', command === 'pnpm' ? 'pnpm run dev' : 'built CLI', 'rejects a missing or invalid ID')
      }
    }
    const profileRuns = new Map()
    for (const { dev, flagProfile, envProfile, profile, changedEndpoint } of [
      { dev: false, flagProfile: 'fixture-cli', envProfile: 'fixture-vite', profile: 'fixture-cli' },
      { dev: true, envProfile: 'fixture-vite', profile: 'fixture-vite' },
      { dev: false, flagProfile: 'fixture-shared', profile: 'fixture-shared' },
      { dev: true, envProfile: 'fixture-shared', profile: 'fixture-shared', changedEndpoint: true },
    ]) {
      const port = dev ? 4199 : 4198
      // Codex is absent on this host; CLI precedence deliberately overrides a refused env URL.
      const devEndpoint = changedEndpoint ? (unix ? endpoint.replace(/codex\.sock$/, '%63odex.sock') : endpoint + '?forwarded=1') : endpoint
      const env = {
        ...process.env, ...storageEnv, CODEXUI_APP_SERVER_URL: dev ? devEndpoint : 'ws://127.0.0.1:1',
        CODEXUI_REMOTE_UPLOAD_DIR: '/fixture/attachments',
      }
      if (envProfile === undefined) delete env.CODEXUI_CONNECTION_PROFILE
      else env.CODEXUI_CONNECTION_PROFILE = envProfile
      const profileArgs = flagProfile === undefined ? [] : ['--connection-profile', flagProfile]
      const child = spawn(dev ? 'pnpm' : process.execPath, dev
        ? ['run', 'dev', '--host', '127.0.0.1', '--port', String(port)]
        : ['dist-cli/index.js', '--host', '127.0.0.1', '--port', String(port), '--no-open', '--app-server-url', endpoint, ...profileArgs], {
        env,
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
        assert.equal(output.includes('Endpoint changed'), Boolean(changedEndpoint), output)
        for (const path of ['/codex-api/git/repository-status', '/codex-api/prompts', '/codex-api/thread-titles', '/codex-api/worktree/create', '/codex-api/worktree/branches', '/codex-api/thread/rollback-files', '/codex-api/github-clone', '/codex-api/local-directory', '/codex-api/projectless-thread-cwd', '/codex-api/project-root-suggestion', '/codex-api/telegram/config', '/codex-api/telegram/configure-bot', '/codex-api/telegram/status', '/codex-api/telegram/test-notification', '/codex-api/worktree/create-permanent', '/codex-api/thread-file-change-fallback', '/codex-api/thread-live-state', '/codex-api/thread-stream-events', '/codex-api/thread-turn-page', '/codex-api/connection-diagnostics', '/codex-api/uploads', '/codex-api/meta/methods']) {
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
        for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
          const missing = await fetch(url + '/codex-api/unknown-maintenance-route', { method })
          assert.equal(missing.status, 404)
          assert.match(missing.headers.get('content-type'), /application\/json/)
          if (method !== 'HEAD') assert.deepEqual(await missing.json(), { error: 'Not found' })
        }
        const call = async (method) => {
          const response = await fetch(url + '/codex-api/rpc', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params: method === 'account/login/start' ? { type: 'chatgpt' } : { threadId: 'fixture', name: 'Native title' } }),
          })
          return { status: response.status, body: await response.json() }
        }
        const profileResponse = await fetch(url + '/codex-api/connection-profile')
        assert.equal(profileResponse.headers.get('cache-control'), 'no-store')
        assert.deepEqual(await profileResponse.json(), { connectionProfile: profile })
        const preferences = async (kind, params) => {
          const response = await fetch(url + '/codex-api/rpc', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'model-preferences/' + kind, params }),
          })
          assert.equal(response.status, 200)
          return (await response.json()).result
        }
        const previousRuns = profileRuns.get(profile) ?? 0
        const preferred = { providerId: 'fixture-provider', modelId: profile, reasoningEffort: 'high', collaborationMode: 'default' }
        assert.deepEqual((await preferences('read')).preferred, previousRuns ? preferred : null)
        assert.equal(connections, before, 'profile bootstrap and preferences do not contact the App Server')
        await preferences('update', { preferred })
        const attachment = new FormData()
        attachment.set('file', new Blob([profile]), 'profile.txt')
        const beforeUpload = frames.length
        const uploadResponse = await fetch(url + '/codex-api/upload-file', { method: 'POST', body: attachment })
        const { path: uploaded, error } = await uploadResponse.json()
        assert.equal(uploadResponse.status, 200, error)
        const uploadMethods = frames.slice(beforeUpload).map(frame => frame.method)
        assert.equal(uploadMethods.filter(method => method === 'fs/getMetadata').length, 6)
        assert.equal(uploadMethods.includes('config/read'), false)
        assert.deepEqual(uploadMethods.slice(-2), ['fs/createDirectory', 'fs/writeFile'])
        const hash = profileDirectoryName(profile)
        assert(uploaded.startsWith('/fixture/attachments/codexapp-uploads/' + hash + '/'))
        assert.equal(files.get(uploaded).toString(), profile)
        const { data } = resolveWebuiStorage({ ...process.env, ...storageEnv }, process.platform, storageEnv.HOME)
        const ledger = JSON.parse(readFileSync(join(data, 'app-servers', hash, 'uploads', 'inventory.json'), 'utf8'))
        assert.equal(ledger.records.length, previousRuns + 1)
        profileRuns.set(profile, previousRuns + 1)
        assert(ledger.records.every(record => record.path.startsWith('/fixture/attachments/codexapp-uploads/' + hash + '/')))
        assert.deepEqual(readdirSync(storageEnv.CODEX_HOME).sort(), Object.keys(oldFiles).sort())
        for (const [name, raw] of Object.entries(oldFiles)) {
          assert.equal(readFileSync(join(storageEnv.CODEX_HOME, name), 'utf8'), raw)
        }
        console.log('PASS', profile, previousRuns ? 'reuses' : 'initializes', 'preferences and upload accounting with an untouched Codex home')
        const [unknown, active] = await Promise.all([call('maintenance/unknown'), call('account/read')])
        assert.equal(unknown.status, 502)
        assert.deepEqual(unknown.body, { error: 'Method not found' })
        for (const method of ['account/usage/read', 'thread/compact/start', 'thread/delete', 'review/start', 'thread/queue/add', 'thread/queue/update', 'thread/queue/delete', 'thread/queue/reorder', 'thread/queue/start', 'thread/settings/update']) {
          assert.deepEqual(await call(method), { status: 502, body: { error: 'Method not found', rpcCode: -32601 } })
        }
        assert.deepEqual(await call('account/login/start'),{status:502,body:{error:'Native sign-in requires a signed-out account',rpcCode:-32600}})
        assert.deepEqual(await call('account/login/cancel'),{status:502,body:{error:'No matching backend native login to cancel',rpcCode:-32602}})
        assert.deepEqual(await call('config/value/write'),{status:502,body:{error:'Method not found'}})
        assert.equal(active.status, 200)
        assert.deepEqual(await call('generate-thread-title'), { status: 502, body: { error: 'Method not found' } })
        const auth = await call('getAuthStatus')
        assert.equal(auth.status, 403)
        assert.equal(frames.some(frame => frame.method === 'getAuthStatus'), false)
        assert.deepEqual(active.body, { result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } })
        assert.equal((await call('accountSession/switch')).status, 403)
        assert.deepEqual(await call('thread/name/set'), { status: 200, body: { result: {} } })
        const historyRequest = async (method, params) => {
          const response = await fetch(url + '/codex-api/rpc', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params: { threadId: historyId, ...params } }),
          })
          const body = await response.json()
          assert(response.ok, JSON.stringify(body))
          return body.result
        }
        const historyStart = frames.length
        const latest = await historyRequest('thread/read', { includeTurns: true })
        assert.equal(latest.olderCursor, olderCursor)
        assert.deepEqual(latest.thread.turns, historyTurns.slice(5))
        const older = await historyRequest('thread/turns/list', { cursor: latest.olderCursor, itemsView: 'full', sortDirection: 'desc', limit: 10 })
        assert.deepEqual(older, { data: historyTurns.slice(0, 5).reverse(), nextCursor: null })
        const historyFrames = frames.slice(historyStart).filter(frame => frame.params?.threadId === historyId)
        const { method: firstMethod, params: firstParams } = historyFrames[0]
        assert.deepEqual({ method: firstMethod, params: firstParams },
          { method: 'thread/read', params: { threadId: historyId, includeTurns: false } })
        assert.deepEqual(historyFrames.filter(frame => frame.method === 'thread/turns/list').map(frame => frame.params), [
          { threadId: historyId, itemsView: 'full', sortDirection: 'desc', limit: 10 },
          { threadId: historyId, cursor: olderCursor, itemsView: 'full', sortDirection: 'desc', limit: 10 },
        ])
        // Historical execution metadata may independently request the rollout path.
        assert(historyFrames.filter(frame => frame.method === 'thread/read').every(frame => frame.params.includeTurns === false))
        console.log('PASS', dev ? 'pnpm run dev' : 'built CLI', 'two bounded native content pages, opaque cursor and no full thread read')
        const metadataRead=async(includeTurns)=>{
          const response=await fetch(url+'/codex-api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'thread/read',params:{threadId:'metadata-status-fixture',...(includeTurns===undefined?{}:{includeTurns})}})})
          return {status:response.status,body:await response.json()}
        }
        assert.equal((await metadataRead(false)).status,200)
        const failedMetadata=await metadataRead(false)
        assert.equal(failedMetadata.status,502);assert.equal(failedMetadata.body.result,undefined)
        assert.equal((await metadataRead()).status,200,'ordinary history reads retain their existing empty-rollout snapshot fallback')
        console.log('PASS',dev?'pnpm run dev':'built CLI','failed activity inspection never receives a cached idle snapshot')
        console.log('PASS', dev ? 'pnpm run dev' : 'built CLI', 'API misses, correlated RPC errors, auth redaction and native titles')
        for (const method of ['account/read', 'modelProvider/list', 'model/list', 'thread/list', 'project/list']) {
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
        const ws = new WebSocket(url.replace('http:', 'ws:') + '/codex-api/ws')
        const [raw] = await once(ws, 'message', { signal: AbortSignal.timeout(5000) })
        const readyFrame = JSON.parse(String(raw))
        assert.equal(readyFrame.method, 'ready')
        assert.equal(readyFrame.params.connectionProfile, profile)
        ws.terminate()
        assert.equal(connections - before, 1)
        console.log('PASS', dev ? 'pnpm run dev' : 'built CLI', 'HTTP RPC and browser WS; one upstream connection')
      } finally {
        const exited = once(child, 'exit')
        process.kill(-child.pid, 'SIGTERM')
        await exited
        assert(server.address(), 'fixture listener survives web shutdown')
      }
    }
    assert(!frames.some(f => f.method === 'model/providerCatalog'))
    assert(frames.filter(f=>f.method==='command/exec').every(f=>!f.params?.command),'Command error-contract fixtures never execute commands')
    assert.equal(frames.filter(f => f.method === 'initialize').length, connections)
    console.log('PASS initialization count:', connections, '; independent fixture listener survives every shutdown')
  } finally {
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => http.close(resolve))
    rmSync(directory, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
