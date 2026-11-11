import { getWorkspaceRootsState, getWorkspaceRootsStateGeneration, invalidateWorkspaceRootsStateCache, updateWorkspaceRootsState, type WorkspaceRootsState, type WorkspaceRootsOperation } from './codexGateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forkThreadFromResponse, reasoningCatalog, getAvailableModelIds, getThreadDetail, resumeThread, startThreadTurn } from './codexGateway'

function mockRpcFetch(): { requests: Array<{ method: string, params: Record<string, unknown> }> } {
  const requests: Array<{ method: string, params: Record<string, unknown> }> = []

  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as { method: string, params: Record<string, unknown> }
      : { method: '', params: {} }

    requests.push(body)

    return new Response(JSON.stringify({
      result: {
        turn: {
          id: `turn-${requests.length}`,
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }))

  return { requests }
}

describe('startThreadTurn collaboration mode payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends default collaboration mode explicitly after a plan turn', async () => {
    reasoningCatalog.value = [{ id: 'gpt-5.4', supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' }]
    const { requests } = mockRpcFetch()

    await startThreadTurn('thread-1', 'make a plan', [], 'gpt-5.4', 'medium', undefined, [], 'plan')
    await startThreadTurn('thread-1', 'implement it', [], 'gpt-5.4', 'medium', undefined, [], 'default')

    expect(requests).toHaveLength(2)
    expect(requests[0].method).toBe('turn/start')
    expect(requests[0].params.collaborationMode).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
    expect(requests[1].method).toBe('turn/start')
    expect(requests[1].params.collaborationMode).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
  })
})

describe('startThreadTurn attachment-only payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['pasted-text-2026-11-04-12-00-00.txt', 'notes.txt'])('sends an empty request and original references for %s', async (name) => {
    const { requests } = mockRpcFetch()
    const file = { label: name, path: `/uploads/${name}`, fsPath: `/uploads/${name}` }

    await startThreadTurn('new-thread', '', [], 'gpt-5.4', 'medium', undefined, [file])

    expect(requests).toHaveLength(1)
    expect(requests[0].params.input).toEqual([{
      type: 'text',
      text: `# Files mentioned by the user:\n\n## ${name}: /uploads/${name}\n\n## My request for Codex:\n\n\n`,
    }])
    expect(requests[0].params.attachments).toEqual([file])
    expect(requests[0]).toEqual({
      method: 'turn/start',
      params: {
        threadId: 'new-thread',
        input: [{
          type: 'text',
          text: `# Files mentioned by the user:\n\n## ${name}: /uploads/${name}\n\n## My request for Codex:\n\n\n`,
        }],
        attachments: [file],
        model: 'gpt-5.4',
        effort: 'medium',
      },
    })
  })
})

describe('startThreadTurn exact input payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    reasoningCatalog.value = []
  })

  it.each([undefined, 'plan', 'default'] as const)('preserves mixed payload with mode %s', async (mode) => {
    reasoningCatalog.value = [{ id: 'gpt-5.4', supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' }]
    const { requests } = mockRpcFetch()
    const file = { label: 'notes', path: '/notes', fsPath: '/notes' }
    await startThreadTurn('thread', 'read', ['https://example.com/a', '/codex-local-image?path=/a.png'], ' gpt-5.4 ', 'medium', [{ name: 'review', path: '/skill' }], [file], mode)
    expect(requests).toEqual([{
      method: 'turn/start',
      params: {
        threadId: 'thread',
        input: [
          { type: 'text', text: '# Files mentioned by the user:\n\n## notes: /notes\n\n## a.png: /a.png\n\n## My request for Codex:\n\nread\n' },
          { type: 'image', url: 'https://example.com/a', image_url: 'https://example.com/a' },
          { type: 'localImage', path: '/a.png' },
          { type: 'skill', name: 'review', path: '/skill' },
        ],
        attachments: [file, { label: 'a.png', path: '/a.png', fsPath: '/a.png' }],
        model: 'gpt-5.4',
        effort: 'medium',
        ...(mode ? { collaborationMode: { mode, settings: { model: 'gpt-5.4', reasoning_effort: 'medium', developer_instructions: null } } } : {}),
      },
    }])
  })

  it('omits optional fields for text-only input', async () => {
    reasoningCatalog.value = []
    const { requests } = mockRpcFetch()
    await startThreadTurn('thread', 'hello')
    expect(requests).toEqual([{ method: 'turn/start', params: { threadId: 'thread', input: [{ type: 'text', text: 'hello' }] } }])
  })
})

describe('getThreadDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves historical provider metadata as data without selecting a connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string; params: Record<string, unknown> }
        : { method: '', params: {} }
      expect(body.method).toBe('thread/read')
      return new Response(JSON.stringify({
        result: {
          thread: {
            id: body.params.threadId,
            modelProvider: 'opencode_zen',
            turns: [],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await expect(getThreadDetail('legacy-thread')).resolves.toMatchObject({
      modelProvider: 'opencode_zen',
    })
  })
})

describe('resumeThread', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces repeated resume failures for the same thread', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string; params: Record<string, unknown> }
        : { method: '', params: {} }
      requests.push(body)
      return new Response(JSON.stringify({ error: 'no rollout found for thread id missing-thread' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const results = await Promise.allSettled([
      resumeThread('missing-thread'),
      resumeThread('missing-thread'),
    ])

    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(requests).toEqual([
      { method: 'thread/resume', params: { threadId: 'missing-thread' } },
    ])
  })

  it('evicts a stalled resume so later resume attempts are not pinned forever', async () => {
    vi.useFakeTimers()
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string; params: Record<string, unknown> }
        : { method: '', params: {} }
      requests.push(body)
      return new Promise<Response>(() => undefined)
    }))

    const first = resumeThread('stalled-thread')
    void resumeThread('stalled-thread')
    expect(requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)

    const retried = resumeThread('stalled-thread')
    expect(retried).not.toBe(first)
    expect(requests).toEqual([
      { method: 'thread/resume', params: { threadId: 'stalled-thread' } },
      { method: 'thread/resume', params: { threadId: 'stalled-thread' } },
    ])
  })
})


describe('official Codex model catalog', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('loads all model/list pages and retains reasoning capabilities without external requests', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      expect(String(url)).toBe('/codex-api/rpc')
      const body = JSON.parse(init.body)
      calls.push(body)
      return new Response(JSON.stringify({ result: body.params?.cursor
        ? { data: [{ id: 'gpt-second' }], nextCursor: null }
        : { data: [{ id: 'gpt-test', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' }], nextCursor: 'page2' } }))
    }))
    const catalog = await getAvailableModelIds()
    expect(catalog.ids).toEqual(['gpt-test', 'gpt-second'])
    expect(catalog.models[0].defaultReasoningEffort).toBe('high')
    expect(calls).toEqual([{ method: 'model/list', params: {} }, { method: 'model/list', params: { cursor: 'page2' } }])
  })
})

describe('MCP directory transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves pagination aliases, ordering, duplicates and complete return shapes', async () => {
    const { listDirectoryMcpServers } = await import('./codexGateway')
    const requests: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      requests.push(body)
      return new Response(JSON.stringify({ result: body.params.cursor
        ? { data: [{ name: 'same', auth_status: 'loggedIn', resource_templates: [{ uri_template: 'test://{id}' }] }], nextCursor: null }
        : { data: [null, { name: '' }, { name: 'same' }], next_cursor: ' page2 ' } }))
    }))
    expect(await listDirectoryMcpServers()).toEqual([
      { name: 'same', authStatus: 'unsupported', tools: [], resources: [], resourceTemplates: [] },
      { name: 'same', authStatus: 'loggedIn', tools: [], resources: [], resourceTemplates: [{ name: '', title: '', uriTemplate: 'test://{id}', description: '' }] },
    ])
    expect(requests).toEqual([
      { method: 'mcpServerStatus/list', params: {} },
      { method: 'mcpServerStatus/list', params: { cursor: ' page2 ' } },
    ])
  })

  it('propagates list, reload and login RPC failures', async () => {
    const { listDirectoryMcpServers, reloadDirectoryMcpServers, startDirectoryMcpLogin } = await import('./codexGateway')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('MCP unavailable') }))
    await expect(listDirectoryMcpServers()).rejects.toThrow('MCP unavailable')
    await expect(reloadDirectoryMcpServers()).rejects.toThrow('MCP unavailable')
    await expect(startDirectoryMcpLogin('server')).rejects.toThrow('MCP unavailable')
  })

  it('preserves status, inspection, reload and OAuth through generic RPC', async () => {
    const { listDirectoryMcpServers, reloadDirectoryMcpServers, startDirectoryMcpLogin } = await import('./codexGateway')
    const requests: Array<{ method: string; params: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      requests.push(body)
      const result = body.method === 'mcpServerStatus/list'
        ? { data: [{ name: 'example', authStatus: 'notLoggedIn', tools: { inspect: { title: 'Inspect' } }, resources: [{ uri: 'example://resource' }] }] }
        : { authorizationUrl: 'https://example.com/oauth' }
      return new Response(JSON.stringify({ result }))
    }))
    expect(await listDirectoryMcpServers()).toEqual([expect.objectContaining({
      name: 'example', authStatus: 'notLoggedIn',
      tools: [expect.objectContaining({ name: 'inspect', title: 'Inspect' })],
      resources: [expect.objectContaining({ uri: 'example://resource' })],
    })])
    await reloadDirectoryMcpServers()
    expect(await startDirectoryMcpLogin('example')).toEqual({ authorizationUrl: 'https://example.com/oauth' })
    expect(requests).toEqual([
      { method: 'mcpServerStatus/list', params: {} },
      { method: 'config/mcpServer/reload', params: {} },
      { method: 'mcpServer/oauth/login', params: { name: 'example' } },
    ])
  })
})

it('loads normal frontend history with one RPC and no legacy diagnostic request', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { thread: { id: 'normal-history', turns: [] } } }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  try {
    const detail = await getThreadDetail('normal-history')
    expect(detail.messages).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/codex-api/rpc')
    expect(JSON.parse(init.body as string)).toMatchObject({ method: 'thread/read', params: { threadId: 'normal-history', includeTurns: true } })
  } finally { vi.unstubAllGlobals() }
})


describe('response fork operation support', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects an old backend response without verified cutoff metadata', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      result: { thread: { id: 'full-fork', turns: [] } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(forkThreadFromResponse('source', 1)).rejects.toThrow('Backend did not verify')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).method).toBe('thread/fork-at-response')
  })
})

// Keep workspace coordination coverage at the public gateway boundary.

describe('workspace roots cache coordination', () => {
  const state: WorkspaceRootsState = { order: ['/a'], active: ['/a'], projectOrder: ['remote'], labels: { '/a': 'A' }, remoteProjects: [{ id: 'remote', hostId: 'host', remotePath: '/remote', label: 'R' }] }
  const response = () => new Response(JSON.stringify({ data: state }))
  function deferred() {
    let resolve!: (response: Response) => void
    let reject!: (error: Error) => void
    const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  afterEach(() => {
    invalidateWorkspaceRootsStateCache()
    vi.unstubAllGlobals()
  })

  it('coalesces concurrent reads, reuses cache, and isolates returned nested values', async () => {
    invalidateWorkspaceRootsStateCache()
    const pending = deferred()
    const fetch = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetch)
    const first = getWorkspaceRootsState()
    const second = getWorkspaceRootsState()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    pending.resolve(response())
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(state)
    a.order.push('/changed')
    a.active.length = 0
    a.projectOrder.push('changed')
    a.labels['/a'] = 'changed'
    a.remoteProjects![0]!.label = 'changed'
    expect(b).toEqual(state)
    expect(await getWorkspaceRootsState()).toEqual(state)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'failure'])('discards stale read %s after generation invalidation', async (outcome) => {
    invalidateWorkspaceRootsStateCache()
    const stale = deferred()
    const fetch = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    const read = getWorkspaceRootsState()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const generation = getWorkspaceRootsStateGeneration()
    invalidateWorkspaceRootsStateCache()
    expect(getWorkspaceRootsStateGeneration()).toBe(generation + 1)
    if (outcome === 'success') stale.resolve(new Response(JSON.stringify({ data: { order: ['/stale'] } })))
    else stale.reject(new Error('stale'))
    expect(await read).toEqual(state)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('serializes mutations, recovers from failure, and publishes an isolated cache before reads', async () => {
    invalidateWorkspaceRootsStateCache()
    const first = deferred()
    const second = deferred()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetch)
    const operation: WorkspaceRootsOperation = { type: 'rename', path: '/a', label: 'A' }
    const failed = updateWorkspaceRootsState(operation)
    const failure = expect(failed).rejects.toThrow('failed')
    const updated = updateWorkspaceRootsState(operation)
    const read = getWorkspaceRootsState()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    first.reject(new Error('failed'))
    await failure
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    second.resolve(response())
    const result = await updated
    result.labels['/a'] = 'changed'
    result.remoteProjects![0]!.label = 'changed'
    expect(await read).toEqual(state)
    expect(await getWorkspaceRootsState()).toEqual(state)
    expect(fetch.mock.calls.map((call) => call[1].method)).toEqual(['PATCH', 'PATCH'])
  })

  it('does not cache failed reads and retries on the next read', async () => {
    invalidateWorkspaceRootsStateCache()
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    await expect(getWorkspaceRootsState()).rejects.toThrow('Failed to load workspace roots state')
    expect(await getWorkspaceRootsState()).toEqual(state)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('getSkillsList normalization boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves directory request arguments and public return shape', async () => {
    const { getSkillsList } = await import('./codexGateway')
    const requests: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ result: { data: [{ cwd: '/A', skills: [{ name: 'one', path: '/skills/one', description: 'long', shortDescription: 'short', scope: 'user', enabled: false }], errors: [] }] } }))
    }))
    for (const cwds of [undefined, [], ['/A'], ['/B', '/C']]) {
      const result: import('./codexGateway').SkillInfo[] = await getSkillsList(cwds)
      expect(result).toEqual([{ name: 'one', displayName: 'one', path: '/skills/one/SKILL.md', description: 'short', scope: 'user', enabled: false }])
    }
    expect(requests).toEqual([
      { method: 'skills/list', params: {} }, { method: 'skills/list', params: {} },
      { method: 'skills/list', params: { cwds: ['/A'] } }, { method: 'skills/list', params: { cwds: ['/B', '/C'] } },
    ])
  })

  it('continues returning empty lists for RPC and normalization errors', async () => {
    const { getSkillsList } = await import('./codexGateway')
    for (const result of [{ data: [] }, { data: null }, { data: [{ skills: [{ name: 'bad', path: 42 }] }] }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result }))))
      expect(await getSkillsList(['/A'])).toEqual([])
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await getSkillsList(['/B'])).toEqual([])
  })
})
