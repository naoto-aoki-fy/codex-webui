import { expect, it, vi } from 'vitest'
import { AppServerClient } from './appServerClient'

function fixture() {
  let account: unknown = null
  let requiresOpenaiAuth = true
  let userId='user-1',workspaceId='workspace-1'
  const client = new AppServerClient()
  vi.spyOn(client as any, 'ensureInitialized').mockResolvedValue(undefined)
  const wire = vi.spyOn(client as any, 'call').mockImplementation(async (method: unknown) => {
    if (method === 'account/read') return { account, requiresOpenaiAuth }
    if (method === 'accountSession/list') return {activeSessionId:'session-1',sessions:[{sessionId:'session-1',isActive:true,userId,selectedWorkspaceAccountId:workspaceId}]}
    if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'login', authUrl: 'https://example.invalid' }
    if (method === 'account/login/cancel') return { status: 'canceled' }
    return { turn: { id: 'turn' } }
  })
  const rpc = (method: string, params: unknown = {}) => client.rpc(method, params)
  const emit = (method: string, params: unknown = {}) => (client as any).emitNotification({ method, params })
  const disconnect = () => (client as any).authentication.disconnect()
  return { client, wire, rpc, emit, disconnect, peek:()=>(client as any).authentication.snapshot(), changeWorkspace:()=>{workspaceId='workspace-2'}, signOut:()=>{account=null}, changeUser:()=>{userId='user-2'}, signIn: () => { account = { type: 'chatgpt', email: 'fixture@example.invalid' } }, custom: () => { requiresOpenaiAuth = false } }
}
const start = (f: ReturnType<typeof fixture>) => f.rpc('account/login/start', { type: 'chatgpt' })
const snapshot = (f: ReturnType<typeof fixture>) => f.rpc('native-authentication/read') as Promise<any>
const reconcile = (f: ReturnType<typeof fixture>) => f.rpc('native-authentication/reconcile', { revision: f.peek().revision })

it('blocks pending sends and automatically restores readiness after matching successful completion', async () => {
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
    await vi.waitFor(() => expect(f.peek()).toMatchObject({phase:'ready'}))
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
    f.signIn() // Account evidence must not erase a retained operation identity.
    await expect(reconcile(f)).rejects.toThrow('pending')
    f.emit('account/login/completed',{loginId:'login',success:true})
    await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'))
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

it('invalidates account evidence and prevents stale reads from authorizing sends', async () => {
  const f = fixture(); f.signIn()
  try {
    await snapshot(f)
    let finish!: (value: unknown) => void
    f.wire.mockImplementationOnce(() => new Promise(r => finish = r))
    f.emit('account/updated')
    const reading = snapshot(f)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    f.emit('account/updated'); finish({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true })
    expect(await reading).toMatchObject({ phase: 'checking' })
    await vi.waitFor(() => expect(f.peek().phase).toBe('ready'))
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
  try { await start(f); expect(await snapshot(f)).toMatchObject({ phase: success ? 'ready' : 'signedOut' }) }
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
    await expect(pending).rejects.toThrow('checking')
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

it('recovers automatically from a verified unchanged account update instead of retaining a manual latch', async () => {
  const f=fixture();f.signIn()
  try {
    await snapshot(f)
    f.emit('account/updated',{authMode:'chatgpt',planType:'plus'})
    await vi.waitFor(async()=>expect(await snapshot(f)).toMatchObject({phase:'ready',blocking:false}))
  } finally {f.client.dispose()}
})

it('coalesces notification bursts and shares automatic recovery with every browser',async()=>{
 const f=fixture();f.signIn();const first:any[]=[],second:any[]=[]
 const a=f.client.onNotification(n=>first.push(n)),b=f.client.onNotification(n=>second.push(n))
 try{
  await snapshot(f);f.wire.mockClear()
  for(let i=0;i<20;i++)f.emit('account/updated',{authMode:'chatgpt'})
  expect(f.peek()).toMatchObject({phase:'checking',blocking:true})
  await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'))
  expect(f.wire.mock.calls.filter(([m])=>m==='account/read')).toHaveLength(1)
  expect(f.wire.mock.calls.filter(([m])=>m==='accountSession/list')).toHaveLength(1)
  expect(first).toEqual(second)
  const records=f.client.getAuthenticationDiagnostics();expect(records.length).toBeLessThanOrEqual(32)
  expect(JSON.stringify(records)).not.toMatch(/fixture@example|session-1|workspace-1|authUrl|loginId/)
 }finally{a();b();f.client.dispose()}
})
it('automatically checks the latest invalidation after discarding an older verification result',async()=>{
 const f=fixture();f.signIn()
 try{
  await snapshot(f);let finish!:(value:unknown)=>void
  f.wire.mockImplementationOnce(()=>new Promise(r=>finish=r))
  f.emit('account/updated');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
  f.emit('account/updated');finish({account:{type:'chatgpt'},requiresOpenaiAuth:true})
  await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'))
  expect(f.client.getAuthenticationDiagnostics().some(r=>r.reason==='verification-superseded')).toBe(true)
  expect(f.wire.mock.calls.filter(([m])=>m==='account/read')).toHaveLength(3)
 }finally{f.client.dispose()}
})
it.each(['workspace','user'] as const)('requires explicit acknowledgment of a changed %s context even with the same email/plan',async field=>{
 const f=fixture();f.signIn()
 try{
  await snapshot(f);field==='workspace'?f.changeWorkspace():f.changeUser();f.emit('account/updated')
  await vi.waitFor(()=>expect(f.peek()).toMatchObject({phase:'reconciliation',reason:'account-context-changed'}))
  await expect(f.rpc('turn/start')).rejects.toThrow('account-context-changed')
  expect(f.peek().contextRevision).toBeGreaterThan(0)
  await reconcile(f);expect(f.peek().phase).toBe('ready')
 }finally{f.client.dispose()}
})
it('requires explicit recovery when supported identity evidence is unavailable, without equating email or plan',async()=>{
 const f=fixture();f.signIn()
 f.wire.mockImplementation(async(m:unknown)=>m==='account/read'?{account:{type:'chatgpt',email:'same@example.invalid',workspaceName:'Same',planType:'plus'},requiresOpenaiAuth:true}:{})
 try{await snapshot(f);f.emit('account/updated');await vi.waitFor(()=>expect(f.peek()).toMatchObject({phase:'reconciliation',reason:'account-identity-unavailable'}));await reconcile(f);expect(f.peek().phase).toBe('ready')}
 finally{f.client.dispose()}
})
it('verifies account updates during a known login without releasing its identity',async()=>{
 const f=fixture()
 try{
  await start(f);f.signIn();f.emit('account/updated');await vi.waitFor(()=>expect(f.peek().reason).toBe('authentication-operation-unresolved'))
  expect(f.peek()).toMatchObject({phase:'pending',loginId:'login',operationUnresolved:true})
  await expect(reconcile(f)).rejects.toThrow('pending');await expect(f.rpc('turn/start')).rejects.toThrow('pending')
  f.emit('account/login/completed',{loginId:'unrelated',success:true});expect(f.peek().loginId).toBe('login')
  f.emit('account/login/completed',{loginId:'login',success:true});await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'))
 }finally{f.client.dispose()}
})
it('keeps a login start awaiting acknowledgment owned across account updates and early matching completion',async()=>{
 const f=fixture();let respond!:(value:unknown)=>void
 f.wire.mockImplementationOnce(async()=>({account:null,requiresOpenaiAuth:true})).mockImplementationOnce(()=>new Promise(r=>respond=r))
 try{
  const starting=start(f);await vi.waitFor(()=>expect(respond).toBeTypeOf('function'));f.signIn();f.emit('account/updated')
  await vi.waitFor(()=>expect(f.peek().reason).toBe('authentication-operation-unresolved'));await expect(reconcile(f)).rejects.toThrow('pending')
  f.emit('account/login/completed',{loginId:'login',success:true});respond({loginId:'login',type:'chatgpt'});await starting
  await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'))
 }finally{f.client.dispose()}
})
it('retains unknown write ownership through a usable account read without replaying login',async()=>{
 const f=fixture()
 try{
  f.wire.mockImplementationOnce(async()=>({account:null,requiresOpenaiAuth:true})).mockRejectedValueOnce(new Error('lost response'))
  await expect(start(f)).rejects.toThrow('lost response');f.signIn();f.emit('account/updated')
  await vi.waitFor(()=>expect(f.peek()).toMatchObject({phase:'unknown',operationUnresolved:true}))
  await expect(f.rpc('turn/start')).rejects.toThrow();expect(f.wire.mock.calls.filter(([m])=>m==='account/login/start')).toHaveLength(1)
 }finally{f.client.dispose()}
})
it.each(['signedOut','failure','malformed','external'] as const)('handles %s verification without automatic error retry',async outcome=>{
 const f=fixture();f.signIn()
 try{
  await snapshot(f);f.wire.mockClear()
  f.wire.mockImplementation(async(m:unknown)=>{
   if(m==='accountSession/list')return {}
   if(outcome==='failure')throw new Error('private upstream detail')
   if(outcome==='malformed')return {}
   return {account:null,requiresOpenaiAuth:outcome!=='external'}
  })
  f.emit('account/updated')
  const phase=outcome==='external'?'reconciliation':outcome==='signedOut'?'signedOut':'unknown'
  await vi.waitFor(()=>expect(f.peek().phase).toBe(phase))
  const reads=f.wire.mock.calls.length;await new Promise(r=>setTimeout(r,70));expect(f.wire.mock.calls).toHaveLength(reads)
  expect(JSON.stringify(f.client.getAuthenticationDiagnostics())).not.toContain('private upstream detail')
 }finally{f.client.dispose()}
})
it('preserves automatic readiness for a provider that does not require OpenAI authentication',async()=>{
 const f=fixture();f.custom()
 try{await snapshot(f);f.emit('account/updated');await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'));await expect(f.rpc('turn/start')).resolves.toBeDefined()}
 finally{f.client.dispose()}
})
it('ignores retired verification evidence on disconnect and rechecks after reconnect',async()=>{
 const f=fixture();f.signIn()
 try{
  await snapshot(f);let respond!:(value:unknown)=>void
  f.wire.mockImplementationOnce(()=>new Promise(r=>respond=r));f.emit('account/updated')
  await vi.waitFor(()=>expect(respond).toBeTypeOf('function'));f.disconnect();respond({account:{type:'chatgpt'},requiresOpenaiAuth:true})
  await new Promise(r=>setTimeout(r,40));expect(f.peek().phase).toBe('disconnected')
  await snapshot(f);await vi.waitFor(()=>expect(f.peek().phase).toBe('ready'))
 }finally{f.client.dispose()}
})
it('retires explicit acknowledgment if another update arrives during its verification',async()=>{
 const f=fixture();f.signIn()
 try{
  await snapshot(f);f.changeWorkspace();f.emit('account/updated');await vi.waitFor(()=>expect(f.peek().phase).toBe('reconciliation'))
  let respond!:(value:unknown)=>void;f.wire.mockImplementationOnce(()=>new Promise(r=>respond=r))
  const acknowledged=reconcile(f);await vi.waitFor(()=>expect(respond).toBeTypeOf('function'))
  f.changeUser();f.emit('account/updated');respond({account:{type:'chatgpt'},requiresOpenaiAuth:true});await acknowledged
  await vi.waitFor(()=>expect(f.peek()).toMatchObject({phase:'reconciliation',reason:'account-context-changed'}))
 }finally{f.client.dispose()}
})
it('does not let a late login start response from a disconnected generation authorize sending',async()=>{
 const f=fixture();let respond!:(value:unknown)=>void
 f.wire.mockImplementationOnce(async()=>({account:null,requiresOpenaiAuth:true})).mockImplementationOnce(()=>new Promise(r=>respond=r))
 try{
  const pending=start(f);const rejected=expect(pending).rejects.toThrow('Connection changed')
  await vi.waitFor(()=>expect(respond).toBeTypeOf('function'));f.disconnect();f.signIn();respond({loginId:'retired',type:'chatgpt'});await rejected
  await snapshot(f);expect(f.peek()).toMatchObject({phase:'unknown',operationUnresolved:true,loginId:null})
  await expect(f.rpc('turn/start')).rejects.toThrow()
 }finally{f.client.dispose()}
})

it('does not forget a previous context across external sign-out and sign-in to a different workspace',async()=>{
 const f=fixture();f.signIn()
 try{
  await snapshot(f);f.signOut();f.emit('account/updated');await vi.waitFor(()=>expect(f.peek().phase).toBe('signedOut'))
  f.signIn();f.changeWorkspace();f.emit('account/updated')
  await vi.waitFor(()=>expect(f.peek()).toMatchObject({phase:'reconciliation',reason:'account-context-changed'}))
 }finally{f.client.dispose()}
})

it('blocks submission across an unacknowledged logout and never replays it', async () => {
  const f = fixture()
  f.signIn()
  try {
    await snapshot(f)
    let rejectLogout!: (error: Error) => void
    f.wire.mockImplementationOnce(() => new Promise((_, reject) => { rejectLogout = reject }))
    const logout = f.rpc('account/logout')
    const failure = expect(logout).rejects.toThrow('lost logout response')
    await vi.waitFor(() => expect(f.peek()).toMatchObject({ phase: 'pending', blocking: true }))
    await expect(f.rpc('turn/start')).rejects.toThrow('authentication')
    const revision = f.peek().revision
    rejectLogout(new Error('lost logout response'))
    await failure
    expect(f.peek()).toMatchObject({ phase: 'unknown', blocking: true, operationUnresolved: true })
    await expect(f.rpc('native-authentication/reconcile', { revision })).rejects.toThrow('Review the current status')
    expect(f.wire.mock.calls.filter(([method]) => method === 'account/logout')).toHaveLength(1)
    expect(f.wire.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
  } finally {
    f.client.dispose()
  }
})

it('forwards only Codex-managed login methods and only public challenge fields', async () => {
  const f = fixture()
  try {
    await expect(f.rpc('account/login/start', { type: 'chatgptAuthTokens', accessToken: 'credential' })).rejects.toThrow('Only Codex-managed')
    expect(f.wire).not.toHaveBeenCalled()
    f.wire.mockResolvedValueOnce({ account: null, requiresOpenaiAuth: true }).mockResolvedValueOnce({
      type: 'chatgpt', loginId: 'owned', authUrl: 'https://example.invalid', accessToken: 'credential',
    })
    const login = await f.rpc('account/login/start', { type: 'chatgpt', accessToken: 'credential' })
    expect(login).toEqual({ type: 'chatgpt', loginId: 'owned', authUrl: 'https://example.invalid' })
    expect(f.wire).toHaveBeenLastCalledWith('account/login/start', { type: 'chatgpt' })
  } finally {
    f.client.dispose()
  }
})
