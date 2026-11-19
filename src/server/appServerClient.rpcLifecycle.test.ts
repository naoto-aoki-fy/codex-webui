import { afterEach, expect, it, vi } from 'vitest'

// Keep the real transport handshake, socket-generation guard, and client pending
// map. Replace only the wire so ordering and elapsed time are deterministic.
const wire = vi.hoisted(() => ({ sockets: [] as any[], metadata: {} as unknown, holdHandshake: false, autoFs: false }))
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    frames: any[] = []
    constructor() {
      super()
      wire.sockets.push(this)
      queueMicrotask(() => this.emit('open'))
    }
    send(raw: string, callback?: (error?: Error) => void) {
      const frame = JSON.parse(raw)
      this.frames.push(frame)
      if (frame.method === 'initialize' && !wire.holdHandshake) queueMicrotask(() => this.reply(frame.id, wire.metadata))
      if (wire.autoFs && frame.method?.startsWith('fs/')) queueMicrotask(() => this.reply(frame.id,
        frame.method === 'fs/getMetadata' ? { isDirectory: true, isSymlink: false } : {}))
      callback?.()
    }
    reply(id: number, result: unknown) { this.emit('message', Buffer.from(JSON.stringify({ id, result })), false) }
    notify(method: string, params: unknown) { this.emit('message', Buffer.from(JSON.stringify({ method, params })), false) }
    terminate() { this.readyState = 3; this.emit('close') }
  }
  return { default: Socket }
})
import { AppServerClient } from './appServerClient'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); wire.sockets.length = 0; wire.metadata = {}; wire.holdHandshake = false; wire.autoFs = false; vi.unstubAllEnvs() })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

it.each(['disconnect', 'replacement'] as const)('isolates stale replies and never replays on %s', async cause => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient()
  const internal = client as any
  try {
    const a = client.rpc('test/unanswered', {})
    const b = client.rpc('test/independent', {})
    const aRejected = expect(a).rejects.toThrow('disconnected')
    const bRejected = expect(b).rejects.toThrow('disconnected')
    await flush()
    const old = wire.sockets[0]!
    expect(old.frames.slice(0, 2).map((f: any) => f.method)).toEqual(['initialize', 'initialized'])
    expect(old.frames.slice(2).map((f: any) => f.method).sort()).toEqual(['test/independent', 'test/unanswered'])
    expect(internal.pending.size).toBe(2)
    expect(internal.transport.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(internal.pending.size).toBe(2)
    expect(wire.sockets).toHaveLength(1)
    const oldIds = old.frames.slice(2).map((f: any) => f.id)
    const generation = internal.connectionGeneration
    if (cause === 'disconnect') old.terminate()
    else await client.reconnect()
    await Promise.all([aRejected, bRejected])
    expect(internal.pending.size).toBe(0)
    expect(internal.connectionGeneration).toBe(generation + 1)
    if (cause === 'disconnect') await client.reconnect()
    const fresh = wire.sockets[1]!
    const c = client.rpc('test/new', {})
    const d = client.rpc('test/new-independent', {})
    await flush()
    const frames = fresh.frames.filter((f: any) => f.method.startsWith('test/'))
    expect(frames.map((f: any) => f.method)).toEqual(['test/new', 'test/new-independent'])
    expect(frames.every((f: any) => !oldIds.includes(f.id))).toBe(true)
    // Even a forged matching *new* ID from the obsolete socket is filtered.
    old.reply(frames[0].id, 'obsolete socket')
    fresh.reply(oldIds[0], 'obsolete request')
    await flush()
    expect(internal.pending.size).toBe(2)
    fresh.reply(frames[1].id, 'independent')
    expect(await d).toBe('independent')
    expect(internal.pending.size).toBe(1)
    fresh.reply(frames[0].id, 'fresh')
    expect(await c).toBe('fresh')
    fresh.reply(frames[0].id, 'duplicate')
    expect(internal.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(old.frames).toHaveLength(4)
  } finally { client.dispose() }
})


it('retains connection metadata and structured RPC errors, and clears metadata on disconnect', async () => {
  const client = new AppServerClient()
  try {
    const call = client.rpc('fs/readFile', { path: '/remote/file' })
    const rejected = expect(call).rejects.toMatchObject({ message: 'Permission denied', code: -32600, data: { path: '/remote/file' } })
    await flush()
    const socket = wire.sockets[0]!
    expect(client.getInitializationMetadata()).toEqual({})
    const frame = socket.frames.find((f: any) => f.method === 'fs/readFile')
    socket.emit('message', Buffer.from(JSON.stringify({ id: frame.id, error: { message: 'Permission denied', code: -32600, data: { path: '/remote/file' } } })), false)
    await rejected
    socket.terminate()
    expect(client.getInitializationMetadata()).toBeNull()
  } finally { client.dispose() }
})

it('expires ordinary calls without replay or cancelling a silent remote command', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient()
  try {
    const ordinary = client.rpc('fs/readFile', { path: '/B/file' })
    const expired = expect(ordinary).rejects.toThrow('outcome unknown')
    const command = client.rpc('command/exec', { command: ['long-turn'], cwd: '/B' })
    await flush()
    await vi.advanceTimersByTimeAsync(60_001)
    await expired
    expect((client as any).pending.size).toBe(1)
    const socket = wire.sockets[0]
    expect(socket.frames.filter((f: any) => f.method === 'command/exec')).toHaveLength(1)
    expect(socket.frames.some((f: any) => /terminate|cancel/.test(f.method))).toBe(false)
    socket.reply(socket.frames.find((f: any) => f.method === 'command/exec').id, 'completed')
    expect(await command).toBe('completed')
  } finally { client.dispose() }
})

it('a missing restored thread never blocks independent RPCs or healthy subscriptions', async () => {
  const client = new AppServerClient()
  try {
    const internal = client as any
    internal.subscribedThreads.add('missing')
    internal.subscribedThreads.add('healthy')
    await client.reconnect()
    await flush()
    const socket = wire.sockets[0]
    const read = client.rpc('model/list', {})
    await flush()
    const missing = socket.frames.find((f: any) => f.params?.threadId === 'missing')
    expect(missing.params.excludeTurns).toBe(true)
    socket.emit('message', Buffer.from(JSON.stringify({ id: missing.id, error: { code: -1, message: 'missing thread' } })), false)
    socket.reply(socket.frames.find((f: any) => f.method === 'model/list').id, 'models')
    expect(await read).toBe('models')
    await flush()
    expect(socket.frames.find((f: any) => f.params?.threadId === 'healthy')).toBeTruthy()
  } finally { client.dispose() }
})

it('coalesces automatic reconnects and never sends an old approval to a reused wire ID', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const client = new AppServerClient()
  try {
    const first = client.rpc('test/read', {})
    await flush()
    const old = wire.sockets[0]
    old.reply(old.frames.find((f: any) => f.method === 'test/read').id, {})
    await first
    const approval = { id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: 't' } }
    old.emit('message', Buffer.from(JSON.stringify(approval)), false)
    const stale = client.listPendingServerRequests()[0].id
    old.terminate()
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(wire.sockets).toHaveLength(2)
    const fresh = wire.sockets[1]
    fresh.emit('message', Buffer.from(JSON.stringify(approval)), false)
    const current = client.listPendingServerRequests()[0].id
    expect(current).not.toBe(stale)
    await expect(client.respondToServerRequest({ id: stale, result: {} })).rejects.toThrow('No pending')
    expect(fresh.frames.some((f: any) => f.id === 7 && !f.method)).toBe(false)
    await client.respondToServerRequest({ id: current, result: { decision: 'accept' } })
    expect(fresh.frames).toContainEqual({ id: 7, result: { decision: 'accept' } })
    expect(wire.sockets).toHaveLength(2)
  } finally { client.dispose(); random.mockRestore() }
})

it.each(['tunnel', 'server restart'])('restores one subscription per thread after %s without replaying in-flight turns', async () => {
  const client = new AppServerClient()
  try {
    const resume = client.rpc('thread/resume', { threadId: 'running' })
    await flush()
    const old = wire.sockets[0]
    old.reply(old.frames.find((f: any) => f.method === 'thread/resume').id, { thread: { id: 'running' } })
    await resume
    const turn = client.rpc('turn/start', { threadId: 'running', input: [] })
    const rejected = expect(turn).rejects.toThrow('disconnected')
    await flush()
    expect(old.frames.some((f: any) => f.method === 'account/read')).toBe(false)
    expect(old.frames.some((f: any) => f.method === 'turn/start')).toBe(true)
    old.terminate()
    await rejected
    await Promise.all([client.reconnect(), client.reconnect()])
    await flush()
    const fresh = wire.sockets[1]
    const frames = fresh.frames.filter((f: any) => f.method === 'thread/resume')
    expect(frames).toHaveLength(1)
    expect(frames[0].params).toEqual({ threadId: 'running', excludeTurns: true })
    expect(fresh.frames.some((f: any) => f.method === 'turn/start')).toBe(false)
    fresh.reply(frames[0].id, { thread: { id: 'running' } })
    await flush()
    expect(fresh.frames.some((f: any) => f.method === 'account/read')).toBe(false)
    expect(wire.sockets).toHaveLength(2)
  } finally { client.dispose() }
})

it('bounds silent resume attempts while healthy threads and unrelated calls recover', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient()
  try {
    const internal = client as any
    for (const id of ['silent', 'b', 'c']) internal.subscribedThreads.add(id)
    await client.reconnect()
    await flush()
    const socket = wire.sockets[0]
    for (const id of ['b', 'c']) socket.reply(socket.frames.find((f: any) => f.params?.threadId === id).id, { thread: { id } })
    const read = client.rpc('model/list', {})
    await flush()
    socket.reply(socket.frames.find((f: any) => f.method === 'model/list').id, 'models')
    expect(await read).toBe('models')
    await vi.advanceTimersByTimeAsync(5001)
    expect(internal.pending.size).toBe(0)
    socket.terminate()
    await client.reconnect()
    await flush()
    expect(internal.recovery.jobs.size).toBe(3)
    expect(internal.pending.size).toBe(3)
    const fresh = wire.sockets[1]
    fresh.terminate()
    await flush()
    expect(internal.recovery.jobs.size).toBe(0)
    expect(internal.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(1) // sole transport reconnect timer
  } finally { client.dispose() }
})

it.each([false, true])('recovers a failed restored subscription (persistent=%s) and delivers notifications', async persistent => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient()
  const events: Array<{ method: string; params: any }> = []
  client.onNotification(event => events.push(event))
  try {
    const initial = client.rpc('thread/resume', { threadId: 'recover-me', excludeTurns: true })
    await flush()
    const old = wire.sockets[0]
    old.reply(old.frames.find((f: any) => f.method === 'thread/resume').id, { thread: { id: 'recover-me' } })
    await initial
    old.terminate()
    await client.reconnect()
    await flush()
    const fresh = wire.sockets[1]
    const failLatest = () => {
      const frame = fresh.frames.filter((f: any) => f.method === 'thread/resume').at(-1)
      fresh.emit('message', Buffer.from(JSON.stringify({ id: frame.id, error: { code: -1, message: 'disposable resume failure' } })), false)
    }
    failLatest()
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    if (persistent) {
      failLatest(); await flush()
      await vi.advanceTimersByTimeAsync(1000)
      failLatest(); await flush()
      await vi.advanceTimersByTimeAsync(2000)
      failLatest(); await flush()
      expect(events).toContainEqual(expect.objectContaining({ method: 'app-server/subscriptionRecovery', params: expect.objectContaining({ threadId: 'recover-me', state: 'failed', attempt: 4 }) }))
    }
    const manual = persistent ? client.rpc('thread/resume', { threadId: 'recover-me', excludeTurns: true }) : null
    await flush()
    const last = fresh.frames.filter((f: any) => f.method === 'thread/resume').at(-1)
    fresh.reply(last.id, { thread: { id: 'recover-me' } })
    if (manual) await manual
    await flush()
    fresh.emit('message', Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'recover-me', itemId: 'after-recovery', delta: 'delivered' } })), false)
    expect(events).toContainEqual(expect.objectContaining({ method: 'app-server/subscriptionRecovery', params: expect.objectContaining({ threadId: 'recover-me', state: 'recovered' }) }))
    expect(events).toContainEqual({ method: 'item/agentMessage/delta', params: { threadId: 'recover-me', itemId: 'after-recovery', delta: 'delivered' } })
    expect(fresh.frames.filter((f: any) => f.method === 'thread/resume')).toHaveLength(persistent ? 5 : 2)
    expect(fresh.frames.some((f: any) => f.method === 'turn/start')).toBe(false)
  } finally { client.dispose() }
})

it.each([{}, { codexHome: 'relative' }])('falls back to thread/config discovery for unusable handshake metadata %j', async metadata => {
  wire.metadata = metadata
  vi.stubEnv('CODEX_HOME', '/webui/state')
  const client = new AppServerClient()
  try {
    const read = client.rpc('thread/read', { threadId: 't', includeTurns: false })
    await flush()
    const old = wire.sockets[0]!
    const frame = old.frames.find((f: any) => f.method === 'thread/read')
    old.reply(frame.id, { thread: { id: 't', path: '/custom/sessions/2026/11/15/rollout-t.jsonl' } })
    await read
    expect(await client.resolveCodexHome()).toBe('/custom')
    expect(old.frames.filter((f: any) => f.method === 'config/read')).toHaveLength(0)
    expect(old.frames.filter((f: any) => f.method === 'thread/read')).toHaveLength(1)
    await client.reconnect()
    const a = client.resolveCodexHome(), b = client.resolveCodexHome()
    await flush()
    const fresh = wire.sockets[1]!
    const configs = fresh.frames.filter((f: any) => f.method === 'config/read')
    expect(configs).toHaveLength(1)
    expect(configs[0].params).toEqual({ includeLayers: true })
    fresh.reply(configs[0].id, { layers: [{ name: { type: 'user', profile: null, file: 'C:\\custom\\config.toml' } }] })
    expect(await a).toBe('C:\\custom')
    expect(await b).toBe('C:\\custom')
    expect(await client.resolveCodexHome()).toBe('C:\\custom')
    expect(fresh.frames.filter((f: any) => f.method === 'config/read')).toHaveLength(1)
  } finally { client.dispose(); vi.unstubAllEnvs() }
})


it('waits for the handshake on the first upload and makes zero discovery config reads', async () => {
  const { stageRemoteUpload } = await import('./remoteUploads')
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '/server/attachments')
  wire.holdHandshake = true
  wire.autoFs = true
  const client = new AppServerClient()
  try {
    const upload = stageRemoteUpload(client, 'test.txt', Buffer.from('test'))
    const concurrentHome = client.resolveCodexHome()
    await flush()
    const socket = wire.sockets[0]
    expect(socket.frames.map((f: any) => f.method)).toEqual(['initialize'])
    socket.reply(socket.frames[0].id, { codexHome: '/server/state' })
    expect(await concurrentHome).toBe('/server/state')
    expect(await upload).toMatch(/^\/server\/attachments\/codexapp-uploads\/[0-9a-f]{64}\//)
    expect(socket.frames.filter((f: any) => f.method === 'config/read')).toHaveLength(0)
    expect(socket.frames.filter((f: any) => f.method === 'initialize')).toHaveLength(1)
    expect(socket.frames.some((f: any) => f.method === 'process/spawn')).toBe(false)
  } finally { client.dispose(); vi.unstubAllEnvs() }
})

it.each([
  { setting: undefined, platformOs: 'linux', codexHome: '/srv/codex-state', home: '/home/remote-user', tool: 'getent', sep: '/' },
  { setting: '', platformOs: 'macos', codexHome: '/private/data/codex', home: '/Users/Remote User', tool: 'dscacheutil', sep: '/' },
  { setting: '  ', platformOs: 'windows', codexHome: 'D:\\codex-state', home: 'C:\\Users\\Remote User', tool: 'GetFolderPath', sep: '\\' },
])('stages default uploads on a $platformOs App Server and shares one home lookup', async ({ setting, platformOs, codexHome, home, tool, sep }) => {
  const { stageRemoteUpload } = await import('./remoteUploads')
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', setting)
  vi.stubEnv('HOME', '/backend-user')
  vi.stubEnv('USERPROFILE', 'Z:\\backend-user')
  vi.stubEnv('CODEX_HOME', '/backend-state')
  wire.metadata = { codexHome, platformOs }
  wire.autoFs = true
  const client = new AppServerClient()
  try {
    const uploads = [stageRemoteUpload(client, 'one.txt', Buffer.from('one')), stageRemoteUpload(client, 'two.txt', Buffer.from('two'))]
    const root = [home, '.codex-webui-uploads', 'codexapp-uploads', ''].join(sep)
    const results = Promise.all(uploads)
    await flush()
    const socket = wire.sockets[0]
    const probes = socket.frames.filter((f: any) => f.method === 'process/spawn')
    expect(probes).toHaveLength(1)
    const { id, params } = probes[0]
    expect(params.command.join(' ')).toContain(tool)
    expect(params.timeoutMs).toBe(5_000)
    expect(params.outputBytesCap).toBe(8_192)
    expect(socket.frames.some((f: any) => f.method.startsWith('fs/'))).toBe(false)
    socket.reply(id, {})
    socket.notify('process/exited', { processHandle: 'unrelated', exitCode: 0, stdout: '/wrong\n', stdoutCapReached: false })
    socket.notify('process/exited', { processHandle: params.processHandle, exitCode: 0, stdout: home + (sep === '/' ? '\n' : '\r\n'), stdoutCapReached: false })
    expect((await results).every(path => path.startsWith(root) && /^[0-9a-f]{64}$/u.test(path.slice(root.length).split(sep)[0]!))).toBe(true)
    expect(await stageRemoteUpload(client, 'three.txt', Buffer.from('three'))).toContain(root)
    expect(socket.frames.filter((f: any) => f.method === 'process/spawn')).toHaveLength(1)
    expect(socket.frames.filter((f: any) => f.method === 'config/read')).toHaveLength(0)
  } finally { client.dispose() }
})

it.each([
  { stdout: '' }, { stdout: 'relative' }, { stdout: 'D:\\different-platform' }, { stdout: '/first\n/second\n' },
  { stdoutCapReached: true }, { outputDrainTimedOut: true }, { exitCode: 1 },
])('rejects an unusable remote home result without staging anything %j', async output => {
  const { stageRemoteUpload } = await import('./remoteUploads')
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', undefined)
  wire.metadata = { codexHome: '/remote/admin/.codex', platformOs: 'linux' }
  const client = new AppServerClient()
  try {
    const rejected = expect(stageRemoteUpload(client, 'one.txt', Buffer.from('one'))).rejects.toThrow(
      /Cannot determine the App Server OS user's home directory.*CODEXUI_REMOTE_UPLOAD_DIR/u,
    )
    await flush()
    const socket = wire.sockets[0]
    const probe = socket.frames.find((f: any) => f.method === 'process/spawn')
    socket.reply(probe.id, {})
    socket.notify('process/exited', {
      processHandle: probe.params.processHandle, exitCode: 0, stdout: '/remote/admin\n', stdoutCapReached: false, ...output,
    })
    await rejected
    expect(socket.frames.some((f: any) => f.method.startsWith('fs/'))).toBe(false)
  } finally { client.dispose() }
})

it('reports unavailable home discovery and still accepts an explicit remote root', async () => {
  const { stageRemoteUpload } = await import('./remoteUploads')
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '')
  wire.metadata = { codexHome: '/server/core' }
  wire.autoFs = true
  const client = new AppServerClient()
  try {
    await expect(stageRemoteUpload(client, 'one.txt', Buffer.from('one'))).rejects.toThrow(
      /Cannot determine the App Server OS user's home directory.*CODEXUI_REMOTE_UPLOAD_DIR/u,
    )
    const socket = wire.sockets[0]
    expect(socket.frames.map((f: any) => f.method)).toEqual(['initialize', 'initialized'])
    vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '/server/override')
    expect(await stageRemoteUpload(client, 'two.txt', Buffer.from('two'))).toContain('/server/override/codexapp-uploads/')
    expect(socket.frames.some((f: any) => f.method === 'process/spawn')).toBe(false)
  } finally { client.dispose() }
})

it('discards a pending upload home lookup on reconnect', async () => {
  wire.metadata = { codexHome: '/server/core', platformOs: 'linux' }
  const client = new AppServerClient()
  try {
    const home = await client.resolveCodexHome()
    const generation = client.getConnectionGeneration()
    const rejected = expect(client.resolveUploadUserHome(home, generation)).rejects.toThrow('Cannot determine')
    await flush()
    const old = wire.sockets[0]
    const probe = old.frames.find((f: any) => f.method === 'process/spawn')
    old.reply(probe.id, {})
    await client.reconnect()
    await rejected
    const discovered = client.resolveUploadUserHome(home, client.getConnectionGeneration())
    await flush()
    const current = wire.sockets[1]
    const currentProbe = current.frames.find((f: any) => f.method === 'process/spawn')
    old.notify('process/exited', { processHandle: probe.params.processHandle, exitCode: 0, stdout: '/stale-home\n', stdoutCapReached: false })
    current.reply(currentProbe.id, {})
    current.notify('process/exited', { processHandle: currentProbe.params.processHandle, exitCode: 0, stdout: '/current-home\n', stdoutCapReached: false })
    expect(await discovered).toBe('/current-home')
  } finally { client.dispose() }
})

it.each([
  ['/server/custom', 'must be outside'],
  ['', 'Cannot verify the App Server Codex home'],
  ['/server/other-core', ''],
])('checks config discovery before any upload filesystem call, with home %j', async (home, error) => {
  const { stageRemoteUpload } = await import('./remoteUploads')
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '/server/custom/attachments')
  wire.autoFs = true
  const client = new AppServerClient()
  try {
    const upload = stageRemoteUpload(client, 'test.txt', Buffer.from('test'))
    const result = error ? expect(upload).rejects.toThrow(error) : expect(upload).resolves.toContain('/server/custom/attachments/')
    await flush()
    const socket = wire.sockets[0]
    const configs = socket.frames.filter((f: any) => f.method === 'config/read')
    expect(configs).toHaveLength(1)
    expect(socket.frames.some((f: any) => f.method.startsWith('fs/'))).toBe(false)
    socket.reply(configs[0].id, { layers: home ? [{ name: { type: 'user', profile: null, file: home + '/config.toml' } }] : [] })
    await result
    expect(socket.frames.some((f: any) => f.method === 'fs/writeFile')).toBe(!error)
  } finally { client.dispose() }
})

it('does not send a validated filesystem mutation on a replacement connection', async () => {
  const client = new AppServerClient()
  try {
    wire.metadata = { codexHome: '/server/first' }
    expect(await client.resolveCodexHome()).toBe('/server/first')
    const generation = client.getConnectionGeneration()
    const mutation = client.uploadRpc('fs/createDirectory', { path: '/server/second', recursive: true }, generation)
    const rejected = expect(mutation).rejects.toThrow(/connection changed during upload|Retired app-server initialization/)
    wire.metadata = { codexHome: '/server/second' }
    await client.reconnect()
    await rejected
    expect(wire.sockets.flatMap(socket => socket.frames).some(f => f.method === 'fs/createDirectory')).toBe(false)
    await expect(client.uploadRpc('fs/writeFile', {}, generation)).rejects.toThrow('connection changed during upload')
    expect(wire.sockets[1].frames.some((f: any) => f.method === 'fs/writeFile')).toBe(false)
  } finally { client.dispose() }
})

it('applies handshake home before internal reads and subscription recovery, and replaces it on reconnect', async () => {
  wire.metadata = { codexHome: '/server/first' }
  const client = new AppServerClient()
  const internal = client as any
  try {
    const read = internal.call('thread/read', { threadId: 't', includeTurns: false })
    await flush()
    const old = wire.sockets[0]
    const frame = old.frames.find((f: any) => f.method === 'thread/read')
    old.reply(frame.id, { thread: { path: '/other/sessions/2026/11/15/rollout-t.jsonl' } })
    await read
    expect(await client.resolveCodexHome()).toBe('/server/first')
    internal.subscribedThreads.add('t')
    wire.metadata = { codexHome: '/server/second' }
    await client.reconnect()
    await flush()
    const fresh = wire.sockets[1]
    expect(await client.resolveCodexHome()).toBe('/server/second')
    const resume = fresh.frames.find((f: any) => f.method === 'thread/resume')
    expect(resume).toBeTruthy()
    // Obsolete transport replies cannot affect the new cache, even with a new ID.
    old.reply(resume.id, { thread: { path: '/stale/sessions/2026/11/15/rollout-t.jsonl' } })
    fresh.reply(resume.id, { thread: { id: 't' } })
    expect(await client.resolveCodexHome()).toBe('/server/second')
    expect([...old.frames, ...fresh.frames].filter((f: any) => f.method === 'config/read')).toHaveLength(0)
  } finally { client.dispose() }
})

it('rejects obsolete initialization and cannot seed the replacement cache from its response', async () => {
  wire.holdHandshake = true
  const client = new AppServerClient()
  try {
    const stale = client.resolveCodexHome()
    const rejected = expect(stale).rejects.toThrow('reset')
    await flush()
    const old = wire.sockets[0]
    const reconnect = client.reconnect()
    await rejected
    await flush()
    const fresh = wire.sockets[1]
    old.reply(old.frames[0].id, { codexHome: '/obsolete' })
    fresh.reply(fresh.frames[0].id, { codexHome: '/current' })
    await reconnect
    expect(await client.resolveCodexHome()).toBe('/current')
    expect(fresh.frames.filter((f: any) => f.method === 'config/read')).toHaveLength(0)
  } finally { client.dispose() }
})
