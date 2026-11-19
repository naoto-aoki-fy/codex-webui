import { afterEach, describe, expect, it, vi } from 'vitest'
import { rpcCall } from './codexRpcClient'
afterEach(() => vi.unstubAllGlobals())
describe('RPC error evidence', () => {
  it('retains explicit method-not-found evidence from the scoped usage response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Method not found', rpcCode: -32601 }), { status: 502 })))
    await expect(rpcCall('account/usage/read')).rejects.toMatchObject({ rpcCode: -32601, method: 'account/usage/read', status: 502 })
  })
  it('does not infer unsupported from a permission error or change successful results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Permission denied' }), { status: 502 })).mockResolvedValueOnce(new Response(JSON.stringify({ result: { ok: true } }))))
    await expect(rpcCall('thread/read')).rejects.toMatchObject({ rpcCode: undefined })
    await expect(rpcCall('thread/read')).resolves.toEqual({ ok: true })
  })
})
