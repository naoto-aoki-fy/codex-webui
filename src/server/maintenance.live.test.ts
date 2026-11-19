import { expect, it } from 'vitest'
import WebSocket from 'ws'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveAppServerUrl } from './appServerWebSocketClient'
import { listNativeProjects } from '../nativeProjects'
import { RolloutGenerationMetadata, parseRolloutMetadata } from './rolloutGenerationMetadata'
import { getCodexGlobalStatePath } from './codexGlobalState'
import { profileStorageDirectory } from './connectionProfile'
import { storageNames } from './webuiStorage.mjs'
import { createConversationTransfers } from './conversationTransfer'
import { normalizeThreadMessagesV2 } from '../api/normalizers/v2'

// Explicit opt-in only: uses credentials and disposable real turns, never CI.
it.skipIf(process.env.CODEX_MAINTENANCE_LIVE !== '1')('accepts native Projects, fork/revert, transfer and persistent rollout cache on the live server', async () => {
  const home = process.env.MAINTENANCE_STATE_HOME || await mkdtemp(join(tmpdir(), 'maintenance-live-'))
  await mkdir(home, { recursive: true })
  const tag = 'maintenance-' + randomUUID()
  const root = '/tmp/codexapp-' + tag
  const ws = new WebSocket(resolveAppServerUrl())
  let sequence = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  const calls: Array<{ method: string; params: any }> = []
  ws.on('message', raw => {
    const frame = JSON.parse(String(raw)), entry = pending.get(frame.id)
    if (!entry) return
    clearTimeout(entry.timer); pending.delete(frame.id)
    if (frame.error) entry.reject(Object.assign(new Error(frame.error.message), frame.error))
    else entry.resolve(frame.result)
  })
  await new Promise<void>((done, fail) => { ws.once('open', done); ws.once('error', fail) })
  const rpc = (method: string, params: any): Promise<any> => new Promise((done, fail) => {
    const id = ++sequence
    calls.push({ method, params })
    const timer = setTimeout(() => { pending.delete(id); fail(new Error('RPC deadline: ' + method)) }, 20_000)
    pending.set(id, { resolve: done, reject: fail, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const threads = new Set<string>(), projects = new Set<string>()
  const output = resolve('output/playwright/maintenance-live.json')
  const report: Record<string, any> = { tag, checks: {} }
  let originalProjectIds: string[] = []
  try {
    const init = await rpc('initialize', { clientInfo: { name: 'codexapp-maintenance-acceptance', version: '1' }, capabilities: { experimentalApi: true } })
    ws.send(JSON.stringify({ method: 'initialized' }))
    report.server = init.userAgent
    originalProjectIds = (await rpc('project/list', { limit: 100, sortKey: 'position' })).data.map((p: any) => p.id)
    await rpc('fs/createDirectory', { path: root + '/source', recursive: true })
    await rpc('fs/createDirectory', { path: root + '/empty', recursive: true })
    // Scope list assertions and cleanup to IDs created by this run.
    const isolatedRpc = async (method: string, params: any) => {
      const result = await rpc(method, params)
      if (method === 'project/create' && result.project) projects.add(result.project.id)
      if (method === 'project/list') return { ...result, data: result.data.filter((project: { id: string }) => projects.has(project.id)) }
      return result
    }
    const createProject = async (path: string) => (await isolatedRpc('project/create', {
      name: path.split('/').at(-1), roots: [{ path }], idempotencyKey: randomUUID(),
    })).project.id as string
    const projectId = await createProject(root + '/source')
    const emptyProjectId = await createProject(root + '/empty')
    await rpc('project/update', { projectId: emptyProjectId, name: 'Empty ' + tag })
    await rpc('project/move', { projectId: emptyProjectId, beforeProjectId: projectId })
    const projectState = await listNativeProjects(isolatedRpc)
    expect(projectState.map(project => project.id)).toEqual([emptyProjectId, projectId])
    expect(projectState[0]?.roots).toContainEqual(expect.objectContaining({ path: root + '/empty' }))
    await rpc('project/update', { projectId, name: 'Renamed ' + tag })
    await rpc('project/update', { projectId, name: 'Source ' + tag })
    const rooted = await rpc('project/update', { projectId, roots: [{ path: root + '/source' }, { path: root + '/empty' }] })
    expect(rooted.project.roots).toHaveLength(2)
    await rpc('project/update', { projectId, roots: [{ path: root + '/source' }] })
    report.checks.projects = { emptyPreserved: true, orderPreserved: true, renameAndRootUpdate: true }

    const started = await rpc('thread/start', { cwd: root + '/source', projectId, historyMode: 'paginated', persistExtendedHistory: true })
    expect(started.thread.projectId).toBe(projectId)
    const sourceId = started.thread.id; threads.add(sourceId)
    const prompt = (n: number) => `Reply exactly ${tag}_${n}. Do not use tools or change files.`
    const completeTurn = async (n: number) => {
      const { turn } = await rpc('turn/start', { threadId: sourceId, input: [{ type: 'text', text: prompt(n) }] })
      let snapshot: any
      await expect.poll(async () => {
        snapshot = (await rpc('thread/read', { threadId: sourceId, includeTurns: true })).thread
        const outcome = snapshot.turns.find((t: any) => t.id === turn.id)
        if (outcome && ['failed', 'interrupted'].includes(outcome.status)) throw new Error(`Live execution ${outcome.status}: ${JSON.stringify(outcome.error)}`)
        return outcome?.status
      }, { timeout: 60_000, interval: 500 }).toBe('completed')
      return snapshot
    }
    await completeTurn(1)
    let source = await completeTurn(2)
    const sourceReads = () => calls.filter(c => c.method === 'fs/readFile' && c.params.path === source.path).length
    const cacheClient = { rpc, generation: () => 1, home: () => init.codexHome }
    const cold = await new RolloutGenerationMetadata(cacheClient).recover(sourceId)
    expect(cold.size).toBe(2)
    const reads = sourceReads()
    const restarted = new RolloutGenerationMetadata(cacheClient)
    expect(await restarted.recover(sourceId)).toEqual(cold)
    expect(sourceReads()).toBe(reads)
    const cachePath = join(profileStorageDirectory('cache'), storageNames.rolloutCache, 'v1',
      createHash('sha256').update(sourceId).digest('hex') + '.json')
    const stored = JSON.parse(await readFile(cachePath, 'utf8'))
    expect(stored.turns).toHaveLength(2)
    const bundle = join(home, 'cache-restart-bundle')
    const restartFixture = join(home, 'cache-restart-fixture.json')
    await writeFile(restartFixture, JSON.stringify({ threadId: sourceId, path: source.path, turns: 2 }))
    await promisify(execFile)(process.execPath, ['-e', `require('tsup').build({ entry: ['src/server/rolloutGenerationMetadata.ts'], format: ['cjs'], outDir: ${JSON.stringify(bundle)}, config: false, silent: true })`], { timeout: 30_000 })
    const restart = await promisify(execFile)(process.execPath, ['scripts/test-rollout-cache-restart.cjs', join(bundle, 'rolloutGenerationMetadata.cjs'), restartFixture], { timeout: 30_000 })
    report.checks.freshProcessCacheReuse = JSON.parse(restart.stdout)
    source = await completeTurn(3)
    const refreshed = await restarted.recover(sourceId)
    expect(refreshed.size).toBe(3)
    expect(sourceReads()).toBe(reads + 1)
    expect(parseRolloutMetadata('malformed\n')).toEqual(new Map())
    report.checks.rolloutCache = { coldTurns: cold.size, restartedSourceReads: 0, appendedTurns: refreshed.size, appendedSourceReads: 1, persistentCacheCreated: true }

    await rpc('fs/createDirectory', { path: root + '/registered', recursive: true })
    const registeredId = await createProject(root + '/registered')
    const createCall = calls.find(c => c.method === 'project/create' && c.params.roots[0]?.path === root + '/registered')!
    expect((await isolatedRpc('project/create', createCall.params)).project.id).toBe(registeredId)
    await rpc('project/delete', { projectId: registeredId })
    expect((await listNativeProjects(rpc)).some(project => project.id === registeredId)).toBe(false)
    projects.delete(registeredId)
    report.checks.nativeCreateDelete = { idempotentCreate: true, nativeDeleteVerified: true }
    const fork = (await rpc('thread/fork', { threadId: sourceId })).thread; threads.add(fork.id)
    expect(fork.turns).toHaveLength(3); expect(fork.projectId).toBe(projectId)
    const forkMetadata = await new RolloutGenerationMetadata(cacheClient).recover(fork.id)
    await rpc('thread/revert', { threadId: fork.id, beforeTurnId: fork.turns[1].id })
    const reverted = (await rpc('thread/read', { threadId: fork.id, includeTurns: true })).thread
    expect(reverted.turns).toHaveLength(1)
    const revertMetadata = await new RolloutGenerationMetadata(cacheClient).recover(fork.id)
    expect((await rpc('thread/read', { threadId: sourceId, includeTurns: true })).thread.turns).toHaveLength(3)
    report.checks.nativeForkRevert = { forkTurns: 3, revertedTurns: 1, forkMetadataTurns: forkMetadata.size, revertMetadataTurns: revertMetadata.size, sourceUnchanged: true }

    const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare(sourceId)
    const portable = await transfers.create(prepared.id, started.model, started.modelProvider); threads.add(portable.threadId)
    const decorate = await createConversationTransfers(rpc).decorate(await rpc('thread/read', { threadId: portable.threadId, includeTurns: true }))
    expect(decorate.importedTranscript).toHaveLength(6)
    expect(normalizeThreadMessagesV2(decorate).some(m => m.text === prompt(1))).toBe(true)
    expect(decorate.thread.projectId).toBe(projectId)
    const nativeImported = (await rpc('thread/list', { limit: 100 })).data.find((t: any) => t.id === portable.threadId)
    report.nativeImportedInitiallyListed = Boolean(nativeImported)
    if (!nativeImported) {
      await rpc('thread/name/set', { threadId: portable.threadId, name: 'Portable ' + tag })
      report.nativeImportedListedAfterNativeName = (await rpc('thread/list', { limit: 100 })).data.some((t: any) => t.id === portable.threadId)
    }
    report.importListingCapabilities = {}
    for (const [label, options] of Object.entries({ allProviders: { modelProviders: [] }, stateDb: { useStateDbOnly: true, modelProviders: [] }, search: { searchTerm: tag, modelProviders: [] } })) {
      report.importListingCapabilities[label] = (await rpc('thread/list', { limit: 100, ...options })).data.some((t: any) => t.id === portable.threadId)
    }
    report.checks.portable = { importedMessagesAfterServiceRestart: 6, projectRetained: true }
    if (process.env.MAINTENANCE_BROWSER_BASE_URL) {
      const fixturePath = join(home, 'browser-fixture.json')
      await writeFile(fixturePath, JSON.stringify({ sourceId, forkId: fork.id, portableId: portable.threadId, projectIds: [...projects], threadIds: [...threads], sourceProjectId: projectId, emptyProjectId, emptyRoot: root + '/empty', tag, prompt: prompt(2), expectedModel: [...refreshed.values()][0]?.model }))
      try {
        const child = await promisify(execFile)(process.execPath, ['scripts/test-maintenance-browser.cjs', fixturePath], { timeout: 120_000, env: process.env })
        console.log(child.stdout)
      } finally {
        const rawBrowser = await readFile(fixturePath + '.result.json', 'utf8').catch(() => null)
        if (rawBrowser) {
          const browser = JSON.parse(rawBrowser)
          for (const id of browser.createdThreadIds) threads.add(id)
          report.checks.browser = browser
        }
      }
    }
    expect(calls.filter(c => c.method === 'fs/writeFile')).toEqual([])
    expect((await readFile(getCodexGlobalStatePath(), 'utf8')).includes('codexapp-turn-metadata')).toBe(false)
  } finally {
    for (const threadId of threads) await rpc('thread/archive', { threadId }).catch(error => { report.cleanupError = String(error) })
    for (const projectId of projects) await rpc('project/delete', { projectId }).catch(error => { report.cleanupError = String(error) })
    if (originalProjectIds.length) {
      const after = (await rpc('project/list', { limit: 100, sortKey: 'position' })).data.map((p: any) => p.id)
      expect(after.filter((id: string) => originalProjectIds.includes(id))).toEqual(originalProjectIds)
    }
    report.cleanup = { archivedTestThreads: threads.size, deletedTestProjects: projects.size, existingProjectOrderUnchanged: true }
    await mkdir(resolve('output/playwright'), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2))
    ws.close()
  }
}, 240_000)
