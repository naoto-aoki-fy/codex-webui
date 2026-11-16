import { afterEach, expect, it, vi } from 'vitest'
import { createBackendAuthentication } from './backendAuthentication'
import { rpcCall } from '../api/codexRpcClient'
import { removeLegacyNativeAuthenticationPending } from '../utils/legacyNativeAuthenticationStorage'
vi.mock('../api/codexRpcClient', () => ({ rpcCall: vi.fn() }))
afterEach(() => vi.unstubAllGlobals())
const ready = { phase: 'ready', blocking: false, revision: 2 } as const
const pending = { phase: 'pending', blocking: true, revision: 3 } as const
it('retrieves backend state on reload/reconnect and pushes supersede delayed snapshots', async () => {
  vi.mocked(rpcCall).mockResolvedValue(pending)
  const browser = createBackendAuthentication(), other = createBackendAuthentication()
  expect(browser.blocking.value).toBe(true)
  await Promise.all([browser.refresh(), other.refresh()])
  expect(browser.state.value).toEqual(other.state.value)
  browser.disconnect(); expect(browser.blocking.value).toBe(true)
  vi.mocked(rpcCall).mockResolvedValue(ready)
  await browser.refresh(); expect(browser.blocking.value).toBe(false)
  let resolve!: (value: unknown) => void
  vi.mocked(rpcCall).mockImplementationOnce(() => new Promise(r => resolve = r) as any)
  const refresh = browser.refresh(); browser.observe(pending); resolve(ready); await refresh
  expect(browser.blocking.value).toBe(true)
})
it('fails closed on unavailable or malformed state and retires disposed reads', async () => {
  const browser = createBackendAuthentication()
  vi.mocked(rpcCall).mockRejectedValueOnce(new Error('offline'))
  await browser.refresh(); expect(browser.state.value.phase).toBe('unknown')
  browser.observe({ phase: 'pending', blocking: false, revision: 3 }); expect(browser.blocking.value).toBe(true)
  let resolve!: (value: unknown) => void
  vi.mocked(rpcCall).mockImplementationOnce(() => new Promise(r => resolve = r) as any)
  const refresh = browser.refresh(); browser.dispose(); resolve(ready); await refresh
  expect(browser.blocking.value).toBe(true)
})
it('removes stale legacy/profile latches without affecting unrelated settings or sending', async () => {
  const legacy = 'codex-web-local.native-authentication-pending.v1'
  const entries = new Map([[legacy,'1'],[`codex-profile.other.${legacy}`,'1'],['theme','dark'],['draft','keep'],['other.native-authentication-pending.v1','keep']])
  vi.stubGlobal('window', { localStorage: { get length() { return entries.size }, key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (k: string) => entries.get(k) ?? null, removeItem: (k: string) => entries.delete(k) } })
  removeLegacyNativeAuthenticationPending()
  expect([...entries]).toEqual([['theme','dark'],['draft','keep'],['other.native-authentication-pending.v1','keep']])
  const browser = createBackendAuthentication(); vi.mocked(rpcCall).mockResolvedValue(ready)
  await browser.refresh(); expect(browser.blocking.value).toBe(false)
})
it('ignores inaccessible browser storage', () => {
  vi.stubGlobal('window', { get localStorage() { throw new Error('restricted') } })
  expect(removeLegacyNativeAuthenticationPending).not.toThrow()
})
it('hydrates checking state on reload and invalidates caches before publishing newer readiness',async()=>{
 const order:string[]=[],browser=createBackendAuthentication(()=>order.push(`invalidate:${browser.state.value.phase}`))
 vi.mocked(rpcCall).mockResolvedValue({phase:'checking',blocking:true,revision:5,generation:0,contextRevision:2})
 await browser.refresh();expect(browser.blocking.value).toBe(true)
 browser.observe({phase:'ready',blocking:false,revision:6,generation:0,contextRevision:2})
 expect(browser.blocking.value).toBe(false);expect(order).toEqual(['invalidate:checking'])
 browser.observe({phase:'unknown',blocking:true,revision:4,generation:0,contextRevision:1})
 expect(browser.state.value.phase).toBe('ready');expect(order).toHaveLength(1)
})
it('ignores an older hydration response that completes after automatic readiness',async()=>{
 const browser=createBackendAuthentication();let resolve!:(value:unknown)=>void
 vi.mocked(rpcCall).mockImplementationOnce(()=>new Promise(r=>resolve=r) as any)
 const reading=browser.refresh()
 browser.observe({phase:'checking',blocking:true,revision:4,contextRevision:1})
 browser.observe({phase:'ready',blocking:false,revision:5,contextRevision:1})
 resolve({phase:'reconciliation',blocking:true,revision:3});await reading
 expect(browser.state.value.phase).toBe('ready')
})
