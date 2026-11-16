import { expect, it, vi } from 'vitest'
import { AppServerClient } from './appServerClient'

function fixture() {
  let account: unknown = null
  let requiresOpenaiAuth = true
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  vi.spyOn(client as any, 'ensureInitialized').mockResolvedValue(undefined)
  const wire = vi.spyOn(client as any, 'call').mockImplementation(async (method: unknown) => {
    if (method === 'account/read') return { account, requiresOpenaiAuth }
    if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'login', authUrl: 'https://example.invalid' }
    if (method === 'account/login/cancel') return { status: 'canceled' }
    return { turn: { id: 'turn' } }
  })
  const rpc = (method: string, params: unknown = {}) => client.rpc(method, params)
  const emit = (method: string, params: unknown = {}) => (client as any).emitNotification({ method, params })
  const disconnect = () => (client as any).authentication.disconnect()
  return { client, wire, rpc, emit, disconnect, signIn: () => { account = { type: 'chatgpt', email: 'fixture@example.invalid' } }, custom: () => { requiresOpenaiAuth = false } }
}
const start = (f: ReturnType<typeof fixture>) => f.rpc('account/login/start', { type: 'chatgpt' })
const snapshot = (f: ReturnType<typeof fixture>) => f.rpc('native-authentication/read') as Promise<any>
const reconcile = (f: ReturnType<typeof fixture>) => f.rpc('native-authentication/reconcile')

it('blocks sends during pending login, verifies success, and releases only after reconciliation', async () => {
  const f = fixture()
  try {
    await start(f)
    expect(await snapshot(f)).toMatchObject({ phase: 'pending', blocking: true, loginId: 'login' })
    for (const method of ['turn/start','turn/steer','thread/queue/add','thread/queue/update','thread/queue/start','review/start']) {
      await expect(f.rpc(method)).rejects.toThrow('authentication')
      expect(f.wire.mock.calls.some(([m]) => m === method)).toBe(false)
    }
    f.emit('account/login/completed', { loginId: 'unrelated', success: true })
    expect(await snapshot(f)).toMatchObject({ phase: 'pending' })
    f.signIn(); f.emit('account/login/completed', { loginId: 'login', success: true })
    await vi.waitFor(async () => expect(await snapshot(f)).toMatchObject({ phase: 'reconciliation' }))
    await expect(f.rpc('turn/start')).rejects.toThrow('authentication')
    await reconcile(f)
    await expect(f.rpc('turn/start')).resolves.toEqual({ turn: { id: 'turn' } })
  } finally { f.client.dispose() }
})

it('shares one operation across browser clients and reloads without replaying login', async () => {
  const f = fixture(), first: any[] = [], second: any[] = []
  const release = f.client.onNotification(n => first.push(n))
  const release2 = f.client.onNotification(n => second.push(n))
  try {
    await start(f)
    expect(first.filter(n => n.method === 'native-authentication/state')).toEqual(second.filter(n => n.method === 'native-authentication/state'))
    const reload = await snapshot(f)
    expect(reload).toMatchObject({ phase: 'pending', loginId: 'login' })
    await expect(start(f)).rejects.toThrow('already pending')
    expect(f.wire.mock.calls.filter(([m]) => m === 'account/login/start')).toHaveLength(1)
    await f.rpc('account/login/cancel', { loginId: reload.loginId })
    expect(await snapshot(f)).toMatchObject({ phase: 'signedOut' })
  } finally { release(); release2(); f.client.dispose() }
})

it('preserves pending across disconnect/reconnect and elapsed time cannot unblock it', async () => {
  const f = fixture()
  try {
    await start(f); f.disconnect()
    expect(await snapshot(f)).toMatchObject({ phase: 'pending' }) // new transport checked account
    await expect(reconcile(f)).rejects.toThrow('pending')
    const now = vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER)
    try { await expect(f.rpc('turn/start')).rejects.toThrow('pending') } finally { now.mockRestore() }
    f.signIn() // completion was missed during the outage; explicit inspection is evidence
    await reconcile(f)
    await expect(f.rpc('turn/start')).resolves.toBeDefined()
  } finally { f.client.dispose() }
})

it('reconstructs after backend restart from actual account, never an old pending marker', async () => {
  const old = fixture(), restarted = fixture()
  try {
    await start(old)
    expect(await snapshot(restarted)).toMatchObject({ phase: 'signedOut', blocking: true, loginId: null })
    restarted.signIn(); restarted.disconnect()
    expect(await snapshot(restarted)).toMatchObject({ phase: 'ready', blocking: false })
    await expect(restarted.rpc('turn/start')).resolves.toBeDefined()
  } finally { old.client.dispose(); restarted.client.dispose() }
})

it('isolates independent connection contexts/profiles', async () => {
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'first')
  const first = fixture()
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'second')
  const second = fixture(); second.custom()
  try {
    await start(first)
    await expect(second.rpc('turn/start')).resolves.toBeDefined()
    expect(await snapshot(first)).toMatchObject({ phase: 'pending' })
  } finally { first.client.dispose(); second.client.dispose(); vi.unstubAllEnvs() }
})

it('invalidates account evidence and prevents stale reads or delayed indexed writes from authorizing sends', async () => {
  const f = fixture(); f.signIn()
  try {
    await snapshot(f)
    let release!: () => void
    ;(f.client as any).dependencies.threadIndex.call = async (m: string, p: unknown, rpc: any) => {
      await new Promise<void>(r => release = r)
      return rpc(m, p)
    }
    const sending = f.rpc('turn/start')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    f.emit('account/updated', { authMode: 'chatgpt' }); release()
    await expect(sending).rejects.toThrow('reconciliation')
    expect(f.wire.mock.calls.some(([m]) => m === 'turn/start')).toBe(false)
    await reconcile(f)
    let finish!: (value: unknown) => void
    f.wire.mockImplementationOnce(() => new Promise(r => finish = r))
    const reading = snapshot(f)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    f.emit('account/updated'); finish({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true })
    expect(await reading).toMatchObject({ phase: 'reconciliation' })
  } finally { f.client.dispose() }
})

it.each([true, false])('handles completion before start response (success=%s)', async success => {
  const f = fixture()
  f.wire.mockImplementation(async (method: unknown) => {
    if (method === 'account/login/start') {
      if (success) f.signIn()
      f.emit('account/login/completed', { loginId: 'login', success })
      return { loginId: 'login', type: 'chatgpt' }
    }
    if (method === 'account/read') return { account: success && f.wire.mock.calls.some(([m]) => m === 'account/login/start') ? { type: 'chatgpt' } : null, requiresOpenaiAuth: true }
    return {}
  })
  try { await start(f); expect(await snapshot(f)).toMatchObject({ phase: success ? 'reconciliation' : 'signedOut' }) }
  finally { f.client.dispose() }
})

it('keeps uncertain failures blocked and definitive rejection allows fresh preparation', async () => {
  const f = fixture()
  try {
    f.wire.mockImplementationOnce(async () => ({ account: null, requiresOpenaiAuth: true }))
      .mockRejectedValueOnce(Object.assign(new Error('invalid params'), { code: -32602 }))
    await expect(start(f)).rejects.toThrow('invalid params')
    expect(await snapshot(f)).toMatchObject({ phase: 'signedOut' })
    f.wire.mockImplementationOnce(async () => ({ account: null, requiresOpenaiAuth: true }))
      .mockRejectedValueOnce(new Error('deadline exceeded; outcome unknown'))
    await expect(start(f)).rejects.toThrow('outcome unknown')
    expect(await snapshot(f)).toMatchObject({ phase: 'unknown' })
    await expect(f.rpc('turn/start')).rejects.toThrow('unknown')
  } finally { f.client.dispose() }
})

it('checks again after asynchronous wire initialization and never sends a retired authorization', async () => {
  const f = fixture(); f.signIn()
  try {
    await snapshot(f)
    let release!: () => void
    vi.mocked((f.client as any).ensureInitialized).mockImplementationOnce(() => new Promise<void>(r => release = r))
    const send = vi.spyOn(f.client as any, 'sendLine')
    const pending = (f.client as any).callObserved('turn/start', {})
    f.emit('account/updated'); release()
    await expect(pending).rejects.toThrow('reconciliation')
    expect(send).not.toHaveBeenCalled()
  } finally { f.client.dispose() }
})

it('coalesces account hydration and ordinary verified sends add no account requests', async () => {
  const f = fixture(); f.signIn()
  try {
    await Promise.all([snapshot(f), snapshot(f), snapshot(f)])
    expect(f.wire.mock.calls.filter(([m]) => m === 'account/read')).toHaveLength(1)
    await Promise.all([f.rpc('turn/start'), f.rpc('turn/steer'), f.rpc('thread/queue/add')])
    expect(f.wire.mock.calls.filter(([m]) => m === 'account/read')).toHaveLength(1)
  } finally { f.client.dispose() }
})

it('does not retain a canceled login when an account update races its acknowledgment', async () => {
  const f = fixture()
  try {
    await start(f)
    f.wire.mockImplementationOnce(async () => { f.emit('account/updated'); return { status: 'canceled' } })
    await f.rpc('account/login/cancel', { loginId: 'login' })
    expect(await snapshot(f)).toMatchObject({ phase: 'signedOut', loginId: null })
    await start(f)
    f.wire.mockImplementationOnce(async () => ({ status: 'notFound' }))
    await f.rpc('account/login/cancel', { loginId: 'login' })
    expect(await snapshot(f)).toMatchObject({ phase: 'unknown', loginId: null })
    await expect(f.rpc('turn/start')).rejects.toThrow()
    await reconcile(f)
    await expect(start(f)).resolves.toHaveProperty('loginId', 'login')
  } finally { f.client.dispose() }
})
