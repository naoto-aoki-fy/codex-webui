const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { createServer } = require('node:http')
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { hostname, tmpdir } = require('node:os')
const { join } = require('node:path')
const { WebSocketServer, WebSocket } = require('ws')
const { fixtureWebuiStorage } = require('./fixture-webui-storage.cjs')

async function verifyCachedPlanInBrowser(backend, threadId, loadRollout, releaseRollout) {
  const { chromium } = require('playwright')
  const viewport = { width: 1280, height: 900 }
  const url = `http://127.0.0.1:4173/#/thread/${threadId}`
  const output = 'output/playwright'
  mkdirSync(output, { recursive: true })
  const browser = await chromium.launch()
  let notifications
  try {
    const page = await browser.newPage({ viewport, colorScheme: 'light' })
    const historyCalls = []
    await page.route('**/codex-api/**', async route => {
      const request = new URL(route.request().url())
      if (request.pathname === '/codex-api/rpc' && route.request().method() === 'POST') {
        const call = route.request().postDataJSON()
        if (call.params?.threadId === threadId && ['thread/read', 'thread/resume', 'thread/turns/list'].includes(call.method)) {
          historyCalls.push(call)
        }
      }
      const response = await route.fetch({ url: new URL(request.pathname + request.search, backend).href })
      await route.fulfill({ response })
    })
    await page.routeWebSocket('**/codex-api/ws', socket => {
      notifications = new WebSocket(backend.replace('http:', 'ws:') + '/codex-api/ws')
      notifications.on('message', raw => socket.send(String(raw)))
      socket.onClose(() => notifications.terminate())
    })
    await page.goto(url)
    const recent = page.locator('[data-message-id="prompt-13"] .message-plan-badge')
    const older = page.locator('[data-message-id="prompt-2"] .message-plan-badge')
    await recent.waitFor()
    await loadRollout()
    await page.getByRole('button', { name: 'Load earlier messages' }).click()
    await older.waitFor()
    assert.equal(await page.locator('.message-plan-badge').count(), 2)
    await older.scrollIntoViewIfNeeded()
    await page.waitForTimeout(2200)
    const blocked = join(output, 'plan-cache-blocked-1280-light.png')
    await page.screenshot({ path: blocked })
    await releaseRollout(historyCalls)
    await older.waitFor({ state: 'hidden' })
    assert.equal(await recent.count(), 1)
    await page.waitForTimeout(2200)
    const resolved = join(output, 'plan-cache-conflict-1280-light.png')
    await page.screenshot({ path: resolved })
    console.log('PASS fresh browser', url, viewport, 'recent and older cached Plan badges during a blocked rollout and later conflict', blocked, resolved)
  } finally {
    notifications?.terminate()
    await browser.close()
  }
}

async function run() {
  const unix = process.env.CODEXAPP_FIXTURE_TRANSPORT === 'unix'
  const verifyBrowser = process.env.CODEXAPP_FIXTURE_BROWSER === '1'
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
  const historyTurns = Array.from({ length: 15 }, (_, index) => ({
    id: 'turn-' + index, status: 'completed', items: [
      { id: 'prompt-' + index, type: 'userMessage', content: [{ type: 'text', text: 'Fixture prompt ' + index }] },
    ],
  }))
  const historyThread = {
    id: historyId, name: 'Plan cache fixture', preview: 'Fixture prompt', cwd: '/fixture/project',
    createdAt: 1795136100, updatedAt: 1795136100, status: { type: 'idle' }, modelProvider: 'fixture-provider',
  }
  const olderCursor = 'native-opaque-cursor'
  const questionCases = new Map()
  const rolloutPath = '/fixture/core/sessions/2026/11/20/rollout-fixture.jsonl'
  let heldRollout
  let rolloutRead
  let connections = 0
  server.on('connection', socket => {
    connections++
    let metadataFixtureRead=false
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw)); frames.push(frame)
      if (!frame.method && questionCases.has(frame.id)) {
        const { turnId, outcome } = questionCases.get(frame.id)
        socket.send(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: historyId, requestId: frame.id } }))
        if (outcome === 'cancelled') socket.send(JSON.stringify({ method: 'turn/completed', params: {
          threadId: historyId, turn: { id: turnId, status: 'interrupted', items: [] },
        } }))
        if (outcome === 'disconnect') socket.close()
        return
      }
      if (!frame.method || frame.method === 'initialized') return
      if(frame.method==='thread/read'&&frame.params?.threadId==='metadata-status-fixture'){
        const reply=metadataFixtureRead?{error:{code:-32603,message:'failed to read thread: rollout at /fixture/rollout.jsonl is empty'}}:{result:{thread:{id:'metadata-status-fixture',cwd:'/fixture',status:{type:'idle'},turns:[]}}}
        metadataFixtureRead=true;socket.send(JSON.stringify({id:frame.id,...reply}));return
      }
      if (frame.method === 'turn/start' && frame.params.threadId === historyId) {
        const id = frame.params.input?.[0]?.text === 'Recent Plan fixture' ? 'turn-13'
          : frame.params.collaborationMode?.mode === 'plan' ? 'turn-2' : 'turn-12'
        socket.send(JSON.stringify({ id: frame.id, result: { turn: { id } } }))
        return
      }
      if (heldRollout && frame.method === 'fs/readFile' && frame.params.path === rolloutPath) {
        rolloutRead = raw => socket.send(JSON.stringify({ id: frame.id, result: { dataBase64: Buffer.from(raw).toString('base64') } }))
        return
      }
      if (['turn/start', 'turn/steer'].includes(frame.method)) {
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32600, message: 'Sign in on the App Server to send messages' } }))
        return
      }
      if (frame.method === 'command/exec' || frame.method === 'command/exec/terminate' || frame.method === 'account/usage/read' || frame.method === 'thread/compact/start' || frame.method === 'thread/delete' || frame.method === 'review/start' || frame.method.startsWith('thread/queue/') || frame.method === 'thread/settings/update' || frame.method === 'config/value/write' || frame.method === 'maintenance/unknown' || frame.method === 'generate-thread-title') {
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Method not found' } }))
        return
      }
      if (frame.method === 'model/list') {
        assert.equal(frame.params.modelProvider, 'fixture-provider')
        assert.equal(frame.params.includeHidden, true)
      }
      if (frame.method === 'process/spawn') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }))
        socket.send(JSON.stringify({ method: 'process/exited', params: {
          processHandle: frame.params.processHandle, exitCode: 0, stdout: '/fixture/remote-user\n', stdoutCapReached: false,
        } }))
        return
      }
      if (frame.method === 'fs/writeFile') files.set(frame.params.path, Buffer.from(frame.params.dataBase64, 'base64'))
      const result = frame.method === 'initialize' ? { codexHome: '/fixture/core', platformOs: 'linux' }
        : frame.method === 'fs/getMetadata' ? frame.params.path === rolloutPath
          ? { isFile: true, modifiedAtMs: 1 } : { isDirectory: true, isSymlink: false }
        : frame.method === 'thread/name/set' ? {}
        : frame.method === 'account/read' ? { account: { type: 'apiKey', apiKey: 'fixture-secret' }, requiresOpenaiAuth: true, authToken: 'fixture-secret' }
        : frame.method === 'account/login/start' ? { type: 'chatgpt', loginId: 'fixture-login', authUrl: 'https://example.invalid/sign-in', accessToken: 'fixture-secret' }
        : frame.method === 'account/login/cancel' ? { status: 'canceled' }
        : frame.method === 'modelProvider/list' ? { data: [{ id: 'fixture-provider', displayName: 'Fixture', isDefault: true }] }
        : frame.method === 'model/list' ? { data: [{ id: frame.params.cursor ? 'fixture-hidden' : 'fixture-model', hidden: Boolean(frame.params.cursor), isDefault: !frame.params.cursor }], nextCursor: frame.params.cursor ? null : 'fixture-next' }
        : ['thread/list', 'project/list'].includes(frame.method) ? { data: heldRollout && frame.method === 'thread/list' ? [historyThread] : [], nextCursor: null }
        : ['thread/read', 'thread/resume'].includes(frame.method) && frame.params.threadId === historyId
          ? { thread: { ...historyThread, turns: [], path: heldRollout ? rolloutPath : null }, modelProvider: 'fixture-provider', model: 'fixture-model' }
        : frame.method === 'thread/turns/list' && frame.params.threadId === historyId
          ? { data: frame.params.cursor ? historyTurns.slice(0, 5).reverse() : historyTurns.slice(5).reverse(), nextCursor: frame.params.cursor ? null : olderCursor }
          : {}
      socket.send(JSON.stringify({ id: frame.id, result }))
    })
  })
  try {
    for (const [command, args] of [[process.execPath, ['dist-cli/index.js', '--no-open']], ['pnpm', ['run', 'dev']]]) {
      const invalid = spawnSync(command, args, {
        env: { ...process.env, ...storageEnv, CODEXUI_CONNECTION_PROFILE: '../outside' },
        encoding: 'utf8', timeout: 20_000,
      })
      assert.notEqual(invalid.status, 0)
      assert.match(invalid.stderr, /Invalid App Server ID/)
      console.log('PASS', command === 'pnpm' ? 'pnpm run dev' : 'built CLI', 'rejects an invalid ID')
    }
    const shortHostname = hostname().split('.', 1)[0]
    const profileRuns = new Map()
    for (const { dev, flagProfile, envProfile, profile, uploadOverride } of [
      { dev: false, flagProfile: 'fixture-cli', envProfile: 'fixture-vite', profile: 'fixture-cli', uploadOverride: '/fixture/attachments' },
      { dev: true, envProfile: 'fixture-vite', profile: 'fixture-vite', uploadOverride: '' },
      { dev: false, profile: shortHostname },
      { dev: true, profile: shortHostname },
    ]) {
      const port = dev ? 4199 : 4198
      // Codex is absent on this host; CLI precedence deliberately overrides a refused env URL.
      const env = {
        ...process.env, ...storageEnv, CODEXUI_APP_SERVER_URL: dev ? endpoint : 'ws://127.0.0.1:1',
        CODEXUI_APP_SERVER_RPC_DEADLINE_MS: verifyBrowser && dev && profile === shortHostname ? '15000' : '500',
      }
      if (uploadOverride === undefined) delete env.CODEXUI_REMOTE_UPLOAD_DIR
      else env.CODEXUI_REMOTE_UPLOAD_DIR = uploadOverride
      if (envProfile === undefined) delete env.CODEXUI_CONNECTION_PROFILE
      else env.CODEXUI_CONNECTION_PROFILE = envProfile
      const profileArgs = flagProfile === undefined ? [] : ['--connection-profile', flagProfile]
      const startupFrames = frames.length
      const child = spawn(dev ? 'pnpm' : process.execPath, dev
        ? ['run', 'dev', '--host', '127.0.0.1', '--port', String(port)]
        : ['dist-cli/index.js', '--host', '127.0.0.1', '--port', String(port), '--no-open', '--app-server-url', endpoint, ...profileArgs], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      let output = ''
      let questionStream
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
        const call = async (method, params = { threadId: 'fixture', name: 'Native title' }) => {
          const response = await fetch(url + '/codex-api/rpc', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params }),
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
        assert.equal(uploadMethods.filter(method => method === 'process/spawn').length, uploadOverride ? 0 : 1)
        assert.equal(uploadMethods.filter(method => method === 'fs/getMetadata').length, uploadOverride ? 6 : 7)
        assert.equal(uploadMethods.includes('config/read'), false)
        assert.deepEqual(uploadMethods.slice(-2), ['fs/createDirectory', 'fs/writeFile'])
        const hash = profileDirectoryName(profile)
        const uploadRoot = uploadOverride || '/fixture/remote-user/.codex-webui-uploads'
        const profileUploadDirectory = uploadRoot + '/codexapp-uploads/' + hash + '/'
        assert(uploaded.startsWith(profileUploadDirectory))
        assert.equal(files.get(uploaded).toString(), profile)
        const { data } = resolveWebuiStorage({ ...process.env, ...storageEnv }, process.platform, storageEnv.HOME)
        const ledger = JSON.parse(readFileSync(join(data, 'app-servers', hash, 'uploads', 'inventory.json'), 'utf8'))
        assert.equal(ledger.records.length, previousRuns + 1)
        profileRuns.set(profile, previousRuns + 1)
        assert(ledger.records.every(record => record.path.startsWith(profileUploadDirectory)))
        assert.deepEqual(readdirSync(storageEnv.CODEX_HOME).sort(), Object.keys(oldFiles).sort())
        for (const [name, raw] of Object.entries(oldFiles)) {
          assert.equal(readFileSync(join(storageEnv.CODEX_HOME, name), 'utf8'), raw)
        }
        console.log('PASS', profile, previousRuns ? 'reuses' : 'initializes', 'preferences and upload accounting with an untouched Codex home')
        const firstWrite = frames.length
        for (const method of ['turn/start', 'turn/steer']) {
          assert.deepEqual(await call(method, { threadId: 'fixture', input: [] }), {
            status: 502, body: { error: 'Sign in on the App Server to send messages', rpcCode: -32600 },
          })
        }
        assert.deepEqual(frames.slice(firstWrite).map(frame => frame.method), ['turn/start', 'turn/steer'])
        assert.equal(frames.slice(startupFrames).some(frame => frame.method === 'account/read'), false)
        const [unknown, active] = await Promise.all([call('maintenance/unknown'), call('account/read')])
        assert.equal(unknown.status, 502)
        assert.deepEqual(unknown.body, { error: 'Method not found' })
        for (const method of ['account/usage/read', 'thread/compact/start', 'thread/delete', 'review/start', 'thread/queue/add', 'thread/queue/update', 'thread/queue/delete', 'thread/queue/reorder', 'thread/queue/start', 'thread/settings/update']) {
          assert.deepEqual(await call(method), { status: 502, body: { error: 'Method not found', rpcCode: -32601 } })
        }
        const firstLogin = frames.length
        assert.deepEqual(await call('account/login/start', { type: 'chatgptAuthTokens', accessToken: 'fixture-secret' }), {
          status: 502, body: { error: 'Only Codex-managed ChatGPT sign-in is available through WebUI', rpcCode: -32602 },
        })
        assert.deepEqual(await call('account/login/start', { type: 'chatgpt', accessToken: 'fixture-secret' }), {
          status: 200, body: { result: { type: 'chatgpt', loginId: 'fixture-login', authUrl: 'https://example.invalid/sign-in' } },
        })
        assert.deepEqual(await call('account/login/cancel', { loginId: 'fixture-login' }), {
          status: 200, body: { result: { status: 'canceled' } },
        })
        assert.deepEqual(await call('account/logout', {}), { status: 200, body: { result: {} } })
        assert.deepEqual(frames.slice(firstLogin).map(({ method, params }) => ({ method, params })), [
          { method: 'account/login/start', params: { type: 'chatgpt' } },
          { method: 'account/login/cancel', params: { loginId: 'fixture-login' } },
          { method: 'account/logout', params: {} },
        ])
        assert.deepEqual(await call('config/value/write'),{status:502,body:{error:'Method not found'}})
        assert.equal(active.status, 200)
        assert.deepEqual(await call('generate-thread-title'), { status: 502, body: { error: 'Method not found' } })
        const auth = await call('getAuthStatus')
        assert.equal(auth.status, 403)
        assert.equal(frames.some(frame => frame.method === 'getAuthStatus'), false)
        assert.deepEqual(active.body, { result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } })
        const beforeSessionRequest = frames.length
        assert.equal((await call('accountSession/switch')).status, 403)
        assert.equal(frames.length, beforeSessionRequest)
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
        assert.deepEqual({ ...older, questionResponses: undefined }, { data: historyTurns.slice(0, 5).reverse(), nextCursor: null, questionResponses: undefined })
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
        const nativeSocket = [...server.clients].find(socket => socket.readyState === WebSocket.OPEN)
        questionStream = new WebSocket(url.replace('http:', 'ws:') + '/codex-api/ws')
        await once(questionStream, 'message', { signal: AbortSignal.timeout(5000) })
        const questionEvents = []
        questionStream.on('message', raw => questionEvents.push(JSON.parse(String(raw))))
        const waitForQuestionEvent = async test => {
          for (let attempt = 0; attempt < 40; attempt++) {
            const event = questionEvents.find(test)
            if (event) return event
            await new Promise(resolve => setTimeout(resolve, 10))
          }
          assert.fail('Expected a question event on the WebUI stream')
        }
        const privateValue = 'private fixture value'
        const submitAnswer = async (turnId, method = 'item/tool/requestUserInput', outcome = 'confirmed') => {
          const wireId = `question-${turnId}-${outcome}`
          const callId = `call-${turnId}-${outcome}`
          questionCases.set(wireId, { turnId, outcome })
          const questions = [{ id: 'choice', header: 'Scope' }, { id: 'secret', header: 'Private', isSecret: true }]
          const params = method === 'request_user_input'
            ? { thread_id: historyId, turn_id: turnId, call_id: callId, questions }
            : { threadId: historyId, turnId, itemId: callId, questions }
          nativeSocket.send(JSON.stringify({ id: wireId, method, params }))
          const pending = (await waitForQuestionEvent(event => event.method === 'server/request' && event.params.wireId === wireId)).params
          assert.equal(pending.method, 'item/tool/requestUserInput')
          const answers = { choice: { answers: ['Full', 'Keep examples'] }, secret: { answers: [privateValue] } }
          const sendReply = () => fetch(url + '/codex-api/server-requests/respond', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: pending.id, result: { answers } }),
          })
          const emitResult = (output, overrides = {}, resultCallId = callId) => nativeSocket.send(JSON.stringify({
            method: 'rawResponseItem/completed', params: { threadId: historyId, turnId, ...overrides,
              item: { type: 'function_call_output', call_id: resultCallId, output: JSON.stringify({ answers: output }) },
            },
          }))
          const sentAt = frames.length
          let finished = false
          const reply = sendReply().then(response => { finished = true; return response })
          await waitForQuestionEvent(event => event.method === 'server/request/resolved' && event.params.id === pending.id)
          if (outcome === 'confirmed') {
            emitResult(answers, { threadId: 'wrong-thread' })
            emitResult(answers, { turnId: 'wrong-turn' })
            emitResult(answers, {}, 'wrong-call')
            emitResult({ ...answers, choice: { answers: ['Keep examples', 'Full'] } })
            const marker = `after-mismatches-${wireId}`
            nativeSocket.send(JSON.stringify({ method: marker, params: { threadId: historyId } }))
            await waitForQuestionEvent(event => event.method === marker)
            assert.equal(finished, false, 'closure and mismatches cannot confirm the reply')
            assert.equal(questionEvents.filter(event => event.params?.id === pending.id && event.params.response).length, 0)
            emitResult({ secret: answers.secret, choice: answers.choice })
            emitResult(answers)
          }
          const response = await reply
          const result = await response.json()
          assert.equal(JSON.stringify(result).includes(privateValue), false)
          assert.equal(frames.slice(sentAt).filter(frame => frame.id === wireId).length, 1)
          if (outcome !== 'confirmed') {
            assert.equal(response.status, 502, JSON.stringify(result))
            assert.match(result.error, /could not be confirmed/)
            if (outcome !== 'disconnect') {
              emitResult(answers)
              assert.equal((await sendReply()).status, 502)
            }
            return
          }
          assert.equal(response.status, 200, JSON.stringify(result))
          assert.equal(result.saved, true)
          assert.deepEqual(result.response.questions, [
            { id: 'choice', heading: 'Scope', answers: ['Full', 'Keep examples'] },
            { id: 'secret', heading: 'Private', provided: true },
          ])
          await waitForQuestionEvent(event => event.params?.id === pending.id && event.params.response)
          assert.equal(questionEvents.filter(event => event.params?.id === pending.id && event.params.response).length, 1)
        }
        if (!previousRuns) {
          assert.equal(latest.questionResponses, undefined)
          await submitAnswer('turn-2')
          await submitAnswer('turn-3', 'request_user_input')
          await submitAnswer('turn-13', 'legacy-question-shaped-request')
          await submitAnswer('turn-10', undefined, 'cancelled')
          await submitAnswer('turn-11', undefined, 'timeout')
          assert.equal(JSON.stringify(questionEvents).includes(privateValue), false)
          assert.equal(questionEvents.some(event => event.method === 'rawResponseItem/completed'), false)
          console.log('PASS question closure, matching result, mismatches, duplicates, aliases, cancellation, timeout and private output')
        }
        const populatedAt = frames.length
        const populated = await historyRequest('thread/read', { includeTurns: true })
        const retained = await historyRequest('thread/read', { includeTurns: true, retainedTurnIds: ['turn-2'] })
        const earlier = await historyRequest('thread/turns/list', { cursor: olderCursor, itemsView: 'full', sortDirection: 'desc', limit: 10 })
        assert.deepEqual(populated.questionResponses.map(record => record.turnId), ['turn-13'])
        assert.deepEqual(retained.questionResponses.map(record => record.turnId), ['turn-13', 'turn-2'])
        assert.deepEqual(earlier.questionResponses.map(record => record.turnId), ['turn-3', 'turn-2'])
        assert.deepEqual(earlier.questionResponses[1], retained.questionResponses[1])
        assert.deepEqual(populated.questionResponses[0], retained.questionResponses[0])
        assert.equal(JSON.stringify([populated, retained, earlier]).includes('private fixture value'), false)
        const populatedWire = frames.slice(populatedAt).filter(frame => frame.params?.threadId === historyId)
        assert.equal(populatedWire.filter(frame => frame.method === 'thread/turns/list').length, 3)
        assert(populatedWire.every(frame => !('retainedTurnIds' in frame.params)))
        console.log('PASS', profile, previousRuns ? 'restart' : 'capture', 'one native turn page per request',
          'answer-only bytes latest/retained/older', ...[populated, retained, earlier].map(page => Buffer.byteLength(JSON.stringify(page.questionResponses))))
        const metadataStream = new WebSocket(url.replace('http:', 'ws:') + '/codex-api/ws')
        await once(metadataStream, 'message', { signal: AbortSignal.timeout(5000) })
        const modes = new Map()
        metadataStream.on('message', raw => {
          const message = JSON.parse(String(raw))
          if (message.method === 'turn/generationMetadata' && message.params.threadId === historyId) {
            modes.set(message.params.turnId, message.params.generationMetadata)
          }
        })
        const waitForModes = async ids => {
          for (let attempt = 0; attempt < 50 && ids.some(id => !modes.has(id)); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          assert.deepEqual([...modes.keys()].sort(), [...ids].sort())
        }
        try {
          if (!previousRuns) {
            const beforeModes = frames.length
            for (const [mode, id] of [['plan', 'turn-2'], ['default', 'turn-12']]) {
              const result = await historyRequest('turn/start', { input: [], collaborationMode: { mode } })
              assert.equal(result.turn.id, id)
            }
            assert.deepEqual(frames.slice(beforeModes).map(frame => frame.method), ['turn/start', 'turn/start'])
            await waitForModes(['turn-2', 'turn-12'])
            await preferences('update', { preferred })
          }
          modes.clear()
          const beforeModeRecovery = frames.length
          await historyRequest('thread/read', { includeTurns: true, retainedTurnIds: ['turn-2'] })
          await waitForModes(['turn-2', 'turn-12'])
          assert.deepEqual(Object.fromEntries(modes), {
            'turn-2': { collaborationMode: 'plan', collaborationModeSource: 'submitted' },
            'turn-12': { collaborationMode: 'default', collaborationModeSource: 'submitted' },
          })
          assert.deepEqual(frames.slice(beforeModeRecovery).map(frame => frame.method).sort(),
            ['thread/read', 'thread/read', 'thread/turns/list'])
          assert(!frames.slice(beforeModeRecovery).some(frame => 'retainedTurnIds' in frame.params))
          console.log('PASS', profile, previousRuns ? 'restart' : 'acceptance', 'exact retained Plan and Default mode, unavailable rollout, no extra native calls')
          if (previousRuns) {
            await historyRequest('turn/start', { input: [{ type: 'text', text: 'Recent Plan fixture' }], collaborationMode: { mode: 'plan' } })
            heldRollout = true
            rolloutRead = undefined
            modes.clear()
            const blockedAt = frames.length
            const loadRollout = async () => {
              for (let attempt = 0; attempt < 100 && !rolloutRead; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
              assert(rolloutRead, 'fixture must be holding a remote rollout read')
            }
            const releaseRollout = async browserHistory => {
              const blockedFrames = frames.slice(blockedAt)
              const historyFrames = blockedFrames.filter(frame => frame.params?.threadId === historyId)
              const requests = browserHistory ?? [{ method: 'thread/read', params: { includeTurns: true } }]
              const recentReads = requests.filter(frame => frame.method !== 'thread/turns/list')
              const expectedPages = requests.filter(frame => frame.method === 'thread/turns/list' ||
                (frame.params?.includeTurns !== false && frame.params?.excludeTurns !== true))
              assert.equal(historyFrames.filter(frame => frame.method === 'thread/turns/list').length, expectedPages.length)
              assert.equal(historyFrames.filter(frame => frame.method === 'thread/read' || frame.method === 'thread/resume').length, recentReads.length + 1)
              assert.equal(blockedFrames.filter(frame => frame.method === 'fs/readFile').length, 1)
              assert(!historyFrames.some(frame => 'retainedTurnIds' in frame.params))
              const evidence = [
                { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2', collaboration_mode_kind: 'default' } },
                { type: 'turn_context', payload: { turn_id: 'turn-2', collaboration_mode: { mode: 'plan' } } },
              ]
              modes.clear()
              rolloutRead(evidence.map(row => JSON.stringify(row) + '\n').join(''))
              await waitForModes(['turn-2'])
              assert.deepEqual(modes.get('turn-2'), { collaborationMode: null, collaborationModeSource: 'execution' })
              assert.deepEqual(frames.slice(blockedAt + blockedFrames.length).map(frame => frame.method)
                .filter(method => method?.startsWith('fs/')), ['fs/getMetadata'])
            }
            if (verifyBrowser) {
              await verifyCachedPlanInBrowser(url, historyId, loadRollout, releaseRollout)
            } else {
              await historyRequest('thread/read', { includeTurns: true, retainedTurnIds: ['turn-2'] })
              await loadRollout()
              await waitForModes(['turn-2', 'turn-12', 'turn-13'])
              assert.deepEqual(modes.get('turn-2'), { collaborationMode: 'plan', collaborationModeSource: 'submitted' })
              await releaseRollout()
            }
            heldRollout = false
            modes.clear()
            await historyRequest('thread/read', { includeTurns: true, retainedTurnIds: ['turn-2'] })
            await waitForModes(['turn-12', 'turn-13'])
            console.log('PASS blocked rollout releases exact Plan fallback immediately and later clears a conflicting badge')
          }
        } finally { metadataStream.terminate() }
        if (previousRuns) nativeSocket.send(JSON.stringify({ method: 'thread/deleted', params: { threadId: historyId } }))
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
        if (!previousRuns) {
          await submitAnswer('turn-9', undefined, 'disconnect')
          assert.equal(questionEvents.some(event => event.params?.response?.turnId === 'turn-9'), false)
          assert.equal(JSON.stringify(questionEvents).includes(privateValue), false)
          assert.equal(output.includes(privateValue), false)
          console.log('PASS question disconnect leaves an unconfirmed reply with no private output')
        }
        questionStream.terminate()
      } finally {
        questionStream?.terminate()
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
