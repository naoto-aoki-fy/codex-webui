import { getProjects } from './codexGateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setThreadPinned, acquireReasoningCatalog, forkThreadFromResponse, reasoningCatalog, getAvailableModelIds, getThreadDetail, getThreadGoal, resumeThread, startThreadTurn } from './codexGateway'

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

describe('getThreadGoal response validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for an explicit null Goal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: { goal: null } })))
    await expect(getThreadGoal('thread-1')).resolves.toBeNull()
  })

  it.each([{}, { goal: {} }])('rejects a malformed Goal result: %j', async result => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result })))
    await expect(getThreadGoal('thread-1')).rejects.toThrow('Thread goal response was malformed')
  })
})

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
      if (body.method === 'modelProvider/list') return new Response('Method not found', { status: 400 })
      return new Response(JSON.stringify({ result: body.params?.cursor
        ? { data: [{ id: 'gpt-second' }], nextCursor: null }
        : { data: [{ id: 'gpt-test', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' }], nextCursor: 'page2' } }))
    }))
    const catalog = await getAvailableModelIds()
    expect(catalog.ids).toEqual(['gpt-test', 'gpt-second'])
    expect(catalog.models[0].defaultReasoningEffort).toBe('high')
    expect(calls).toEqual([{ method: 'modelProvider/list', params: {} }, { method: 'config/read', params: {} }, { method: 'model/list', params: { includeHidden: true } }, { method: 'model/list', params: { includeHidden: true, cursor: 'page2' } }])
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

it('loads history and workspace metadata with one normal history RPC', async () => {
  const workspace = { cwd: '/work/日本語 + #', projectId: 'native-project' }
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    result: { thread: { id: 'normal-history', ...workspace, turns: [] } },
  }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  try {
    const detail = await getThreadDetail('normal-history')
    expect(detail.messages).toEqual([])
    expect(detail.workspace).toEqual(workspace)
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
    await expect(forkThreadFromResponse('source', 'turn-1')).rejects.toThrow('Backend did not verify')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).method).toBe('thread/fork-at-response')
  })
})

describe('native projects', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads native projects in server order across pages without caching or rewriting roots', async () => {
    const first = { id: 'b', name: 'Same name', roots: [{ path: 'D:\\projects\\repo' }], position: 0 }
    const second = { id: 'a', name: 'Same name', roots: [], position: 1 }
    const reply = (data: unknown[], nextCursor: string | null) => new Response(JSON.stringify({ result: { data, nextCursor } }))
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply([first], 'next'))
      .mockResolvedValueOnce(reply([second], null))
      .mockResolvedValueOnce(reply([second], null))
    vi.stubGlobal('fetch', fetch)

    expect(await getProjects()).toEqual([first, second])
    expect(await getProjects()).toEqual([second])
    expect(fetch.mock.calls.map(([url, options]) => [url, JSON.parse(options.body)])).toEqual(
      [null, 'next', null].map(cursor => ['/codex-api/rpc', {
        method: 'project/list', params: { cursor, sortKey: 'position', sortDirection: 'asc', limit: 100 },
      }]),
    )
  })

  it('reports an unsupported native server without a fallback', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Method not found', rpcCode: -32601 }), { status: 502 }))
    vi.stubGlobal('fetch', fetch)
    await expect(getProjects()).rejects.toThrow('Upgrade Codex App Server')
    expect(fetch).toHaveBeenCalledTimes(1)
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

describe('shared reasoning catalog during gateway resolution', () => {
  afterEach(() => {
    reasoningCatalog.value = []
    vi.unstubAllGlobals()
  })

  it('makes released leases inert across reacquisition and clears after all successful owners fail', () => {
    const originalRef = reasoningCatalog
    const first = acquireReasoningCatalog()
    const second = acquireReasoningCatalog()
    const models = [{ id: 'A', supportedReasoningEfforts: ['high'] }]
    first.publish(models)
    second.publish(models)
    first.fail()
    expect(reasoningCatalog.value).toEqual(models)
    second.fail()
    expect(reasoningCatalog.value).toEqual([])
    first.release()
    const restarted = acquireReasoningCatalog()
    restarted.publish(models)
    first.release()
    first.fail()
    first.publish([])
    second.release()
    expect(reasoningCatalog).toBe(originalRef)
    expect(reasoningCatalog.value).toEqual(models)
    restarted.release()
    expect(reasoningCatalog.value).toEqual([])
  })

  it('resolves submission against ordered capabilities and ignores stale cleanup', async () => {
    const first = acquireReasoningCatalog()
    const second = acquireReasoningCatalog()
    try {
      const old = first.beginRefresh()
      const fresh = second.beginRefresh()
      const models = [{ id: 'A', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }]
      fresh.publish(models)
      old.publish([{ id: 'A', supportedReasoningEfforts: ['high'] }])
      old.fail()
      expect(reasoningCatalog.value).toEqual(models)
      const requests: Array<{ method: string; params: Record<string, unknown> }> = []
      vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string))
        return new Response(JSON.stringify({ result: { turn: { id: 'ordered' } } }))
      }))
      await expect(startThreadTurn('thread', 'hello', [], 'A', 'high')).resolves.toBe('ordered')
      expect(requests.map((request) => request.method)).toEqual(['turn/start'])
      expect(requests[0]?.params.effort).toBe('low')
      second.beginRefresh().fail()
      expect(reasoningCatalog.value).toEqual([])
      // Old failure/release never advances the successful publication watermark.
      old.publish([])
      expect(reasoningCatalog.value).toEqual([])
    } finally {
      first.release()
      second.release()
    }
  })

  it.each(['replace', 'clear', 'catalog-fallback'] as const)('reads shared capabilities after deferred %s resolution', async (change) => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      requests.push(body)
      if (body.method === (change === 'catalog-fallback' ? 'model/list' : 'config/read')) return pending
      return new Response(JSON.stringify({ result: body.method === 'config/read' ? { config: { model: '' } } : { turn: { id: 'resolved' } } }))
    }))
    const original = [{ id: 'A', supportedReasoningEfforts: ['high'], defaultReasoningEffort: 'high' }]
    reasoningCatalog.value = original
    const sending = startThreadTurn('thread', 'hello', [], undefined, 'high', undefined, [], 'default')
    await vi.waitFor(() => expect(requests.at(-1)?.method).toBe(change === 'catalog-fallback' ? 'model/list' : 'config/read'))
    expect(requests.some((request) => request.method === 'turn/start')).toBe(false)
    reasoningCatalog.value = change === 'clear' ? [] : [{ id: 'A', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }]
    resolve(new Response(JSON.stringify({ result: change === 'catalog-fallback' ? { data: original } : { config: { model: 'A' } } })))
    await expect(sending).resolves.toBe('resolved')
    const effort = change === 'clear' ? undefined : 'low'
    expect(requests.at(-1)).toEqual({ method: 'turn/start', params: {
      threadId: 'thread', input: [{ type: 'text', text: 'hello' }], model: 'A',
      ...(effort ? { effort } : {}),
      collaborationMode: { mode: 'default', settings: { model: 'A', reasoning_effort: effort ?? null, developer_instructions: null } },
    } })
    expect(requests.map((request) => request.method)).toEqual(change === 'catalog-fallback'
      ? ['config/read', 'modelProvider/list', 'model/list', 'turn/start'] : ['config/read', 'turn/start'])
    // Fetching a catalog returns data; it does not publish to the shared ref.
    expect(reasoningCatalog.value).toEqual(change === 'clear' ? [] : [{ id: 'A', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }])
  })

  it('swallows a real catalog fetch failure without clearing another published catalog', async () => {
    const catalog = [{ id: 'A', supportedReasoningEfforts: ['high'] }]
    reasoningCatalog.value = catalog
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce(new Response('Method not found', { status: 400 }))
      .mockResolvedValueOnce(new Response('Method not found', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: catalog } })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAvailableModelIds()).resolves.toEqual({ ids: [], models: [] })
    expect(reasoningCatalog.value).toEqual(catalog)
    await expect(getAvailableModelIds()).resolves.toEqual({ ids: ['A'], models: catalog })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(reasoningCatalog.value).toEqual(catalog)
  })
})

it('pins before the first native row and unpins without writing local state', async () => {
  const { requests } = mockRpcFetch()
  try {
    await setThreadPinned('thread', true, 'first')
    await setThreadPinned('thread', false)
    expect(requests).toEqual([
      { method: 'thread/section/move', params: { threadId: 'thread', sectionId: '01984de2-8f74-7c91-a3b2-5c5e937cf318', beforeThreadId: 'first' } },
      { method: 'thread/section/move', params: { threadId: 'thread', sectionId: null } },
    ])
  } finally { vi.unstubAllGlobals() }
})

it('restores a background subscription without asking for turns or normalizing history', async () => {
  const { resumeThreadSubscription } = await import('./codexGateway')
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ result: { thread: { id: 'background' } } })))
  vi.stubGlobal('fetch', fetch)
  try {
    await expect(resumeThreadSubscription('background')).resolves.toBeUndefined()
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      method: 'thread/resume', params: { threadId: 'background', excludeTurns: true },
    })
  } finally { vi.unstubAllGlobals() }
})


it('returns the native accepted turn ID without recording response metadata', async () => {
  const metadata = { model: 'A', modelSource: 'submitted', effort: null, effortSource: 'submitted' }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { turn: { id: 'accepted', generationMetadata: metadata } } }))))
  await expect(startThreadTurn('thread', 'hello', [], 'A', undefined, undefined, [], undefined)).resolves.toBe('accepted')
})

it('submits only confirmed Fast tiers and explicitly requests standard speed after model switching', async () => {
  const { requests } = mockRpcFetch()
  reasoningCatalog.value = [{ id: 'a', modelProvider: 'p', serviceTiers: [{ id: 'fast' }] }, { id: 'a', modelProvider: 'other', serviceTiers: [] }, { id: 'unknown' }]
  await startThreadTurn('t', 'fast', [], 'provider-model:["p","a"]', undefined, undefined, [], undefined, 'fast')
  expect(requests[0]?.params).toMatchObject({ model: 'a', serviceTierForTurn: 'fast' })
  await expect(startThreadTurn('t', 'bad', [], 'provider-model:["other","a"]', undefined, undefined, [], undefined, 'fast')).rejects.toThrow('unavailable or unknown')
  await expect(startThreadTurn('t', 'unknown', [], 'unknown', undefined, undefined, [], undefined, 'fast')).rejects.toThrow('unavailable or unknown')
  expect(requests).toHaveLength(1)
  await startThreadTurn('t', 'standard', [], 'unknown', undefined, undefined, [], undefined, 'standard')
  expect(requests[1]?.params).toMatchObject({ serviceTierForTurn: 'default' })
  vi.unstubAllGlobals()
})

it('preserves native pin failures rather than returning an empty successful pin list', async () => {
  const { getPinnedThreadState } = await import('./codexGateway')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Native thread sections are required for pinning' }), { status: 500 })))
  await expect(getPinnedThreadState()).rejects.toThrow('Native thread sections are required for pinning')
  vi.unstubAllGlobals()
})

it('serializes Fast enable then disable explicitly without persistent thread-tier overrides', async () => {
  const { setCodexSpeedMode } = await import('./codexGateway')
  const { requests } = mockRpcFetch()
  reasoningCatalog.value = [{ id: 'chosen', modelProvider: 'p', serviceTiers: [{ id: 'fast' }] }]
  await setCodexSpeedMode('fast')
  await startThreadTurn('existing', 'enabled', [], 'provider-model:["p","chosen"]', undefined, undefined, [], undefined, 'fast')
  await setCodexSpeedMode('standard')
  await startThreadTurn('existing', 'disabled', [], 'provider-model:["p","chosen"]', undefined, undefined, [], undefined, 'standard')
  const edits = (value: string | null, mergeStrategy: string) => ({ method: 'config/batchWrite', params: { edits: [
    { keyPath: 'features.fast_mode', value: true, mergeStrategy: 'upsert' },
    { keyPath: 'service_tier', value, mergeStrategy },
  ], filePath: null, expectedVersion: null } })
  expect(requests).toEqual([
    edits('fast', 'upsert'),
    { method: 'turn/start', params: { threadId: 'existing', input: [{ type: 'text', text: 'enabled' }], model: 'chosen', serviceTierForTurn: 'fast' } },
    edits(null, 'replace'),
    { method: 'turn/start', params: { threadId: 'existing', input: [{ type: 'text', text: 'disabled' }], model: 'chosen', serviceTierForTurn: 'default' } },
  ])
  expect(requests.filter(r => r.method === 'turn/start').every(r => !('serviceTier' in r.params))).toBe(true)
  vi.unstubAllGlobals()
})
it('sends an App reference as a native mention alongside ordinary text and skills',async()=>{
 const fetch=vi.fn(async(_input: RequestInfo | URL, _init?: RequestInit)=>new Response(JSON.stringify({result:{turn:{id:'app-turn'}}})))
 vi.stubGlobal('fetch',fetch)
 try{
  await startThreadTurn('app-thread','Use this app',[],undefined,undefined,[{name:'skill',path:'/skill'}],[],undefined,undefined,[{id:'connector_demo',name:'Demo App'}])
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).params.input).toEqual([{type:'text',text:'Use this app'},{type:'skill',name:'skill',path:'/skill'},{type:'mention',name:'Demo App',path:'app://connector_demo'}])
 }finally{vi.unstubAllGlobals()}
})
