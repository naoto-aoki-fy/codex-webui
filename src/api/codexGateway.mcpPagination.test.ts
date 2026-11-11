import { afterEach, expect, it, vi } from 'vitest'
import { listDirectoryMcpServers } from './codexGateway'

afterEach(() => vi.unstubAllGlobals())

it.each([['next', 'next'], ['a', 'b', 'a']])('characterizes repeated MCP cursors %j with a bounded wire', async (...cursors) => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    expect(body.method).toBe('mcpServerStatus/list')
    requests.push(body.params)
    if (requests.length > cursors.length) throw new Error('wire safety bound')
    return new Response(JSON.stringify({ result: { data: [], nextCursor: cursors[requests.length - 1] } }))
  }))
  await expect(listDirectoryMcpServers()).rejects.toThrow('wire safety bound')
  expect(requests).toEqual([{}, ...cursors.map(cursor => ({ cursor }))])
})
