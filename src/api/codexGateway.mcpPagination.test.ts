import { afterEach, expect, it, vi } from 'vitest'
import { listDirectoryMcpServers } from './codexGateway'

afterEach(() => vi.unstubAllGlobals())

it.each([['next', 'next'], ['a', 'b', 'a']])('terminates repeated MCP cursors %j while preserving page order', async (...cursors) => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    expect(body.method).toBe('mcpServerStatus/list')
    requests.push(body.params)
    if (requests.length > cursors.length) throw new Error('wire safety bound')
    return new Response(JSON.stringify({ result: { data: [{ name: `page-${requests.length}` }], nextCursor: cursors[requests.length - 1] } }))
  }))
  const servers = await listDirectoryMcpServers()
  expect(servers.map(server => server.name)).toEqual(cursors.map((_cursor, index) => `page-${index + 1}`))
  expect(requests).toEqual([{}, ...cursors.slice(0, -1).map(cursor => ({ cursor }))])
})

it('preserves snake-case cursors, terminal pages and transport rejection', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: [{ name: 'first' }], next_cursor: 'page2' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: [{ name: 'last' }] } })))
    .mockRejectedValueOnce(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  expect((await listDirectoryMcpServers()).map(server => server.name)).toEqual(['first', 'last'])
  expect(JSON.parse(fetch.mock.calls[1]![1].body).params).toEqual({ cursor: 'page2' })
  await expect(listDirectoryMcpServers()).rejects.toThrow('offline')
})
