import { createHash, randomUUID } from 'node:crypto'
import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'
import { workspaceRootsFromPayload, type WorkspaceRootsState } from './workspaceRootsStore.js'
import type { Project } from './protocol/0.167.2/v2/Project.js'
import type { ProjectImportParams } from './protocol/0.167.2/v2/ProjectImportParams.js'
import { normalizeThreadGroupsV2 } from '../api/normalizers/v2.js'
import { filterGroupsByWorkspaceRoots, getWorkspaceProjectId } from '../utils/legacyDesktopProjectGroups.js'
import { toProjectName } from '../pathUtils.js'

const KEY = 'codexapp-native-project-migrations-v1'
type Rpc = (method: string, params: any) => Promise<any>
type Source = { key: string; name: string; roots: Array<{ path: string }>; threads: string[] }
type Journal = { sources: Source[]; destinations?: Record<string, string>; completed?: boolean }
type Journals = Record<string, Journal>
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** The legacy registry is a frozen migration input, never a second writable registry.
 * Idempotency keys and source snapshots survive ambiguous replies and restarts. */
export class NativeProjects {
  private pending?: Promise<WorkspaceRootsState>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly rpc: Rpc, private readonly identity: () => string) {}

  read(): Promise<WorkspaceRootsState> {
    if (this.pending) return this.pending
    const run = this.queue.then(() => this.load()).finally(() => { if (this.pending === run) this.pending = undefined })
    this.pending = run
    return run
  }

  private async pages(method: string, params: Record<string, unknown>): Promise<any[]> {
    const rows: any[] = [], seen = new Set<string>()
    let cursor: string | null = null
    do {
      const result = await this.rpc(method, { ...params, limit: 100, cursor })
      if (!Array.isArray(result?.data) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new Error(`Incompatible ${method} pagination; project migration stopped`)
      rows.push(...result.data)
      if (rows.length > 100_000) throw new Error('Project migration exceeds 100,000 rows; no partial snapshot is accepted')
      cursor = result.nextCursor
      if (cursor && seen.has(cursor)) throw new Error(`${method} repeated its cursor; project migration stopped`)
      if (cursor) seen.add(cursor)
    } while (cursor)
    return rows
  }

  private project(value: any): Project {
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string'
      || !Array.isArray(value.roots) || value.roots.some((r: any) => typeof r?.path !== 'string')
      || !Number.isFinite(value.position) || !value.metadata || typeof value.metadata !== 'object') throw new Error('Incompatible native Project response; legacy data is unchanged')
    return value
  }

  private async list(): Promise<Project[]> {
    return (await this.pages('project/list', { sortKey: 'position', sortDirection: 'asc' })).map(p => this.project(p))
  }

  private async load(): Promise<WorkspaceRootsState> {
    let projects: Project[]
    try { projects = await this.list() } catch (error: any) {
      if (error.code !== -32601) throw error
      const state = await readCodexGlobalState()
      const journals = state[KEY] as Journals | undefined
      // Never switch back to legacy if this server has accepted any migration work.
      if (journals?.[hash(this.identity())]) throw new Error('Native Project API became unavailable after migration began. Restore server capability; legacy writes are disabled.')
      return { ...workspaceRootsFromPayload(state), projectMode: 'legacy-readonly', projectError: 'Native project/list is unsupported. Legacy projects are read-only; upgrade the App Server to manage projects.' }
    }
    const namespace = hash(this.identity())
    const state = await readCodexGlobalState()
    let journal = (state[KEY] as Journals | undefined)?.[namespace]
    if (!journal) {
      const legacy = workspaceRootsFromPayload(state)
      const keys = [...new Set([...legacy.projectOrder, ...legacy.order, ...legacy.remoteProjects.map(p => p.id)])]
        .filter(key => legacy.order.includes(key) || legacy.remoteProjects.some(p => p.id === key))
      let sources: Source[] = []
      if (keys.length) {
        // This is the only path-membership inference: capture the old UI's exact
        // grouping once, including archived members. All later grouping uses IDs.
        const threads = [...await this.pages('thread/list', { archived: false }), ...await this.pages('thread/list', { archived: true })]
        // Injected-only Portable imports may be absent from native thread/list.
        // Read their native summaries once during migration, without touching the
        // durable transcript receipts or introducing a permanent custom list index.
        const listed = new Set(threads.map(t => t.id))
        const receipts = state['conversation-transfers-v1']
        const importedIds = [...new Set(Object.values(receipts && typeof receipts === 'object' ? receipts : {})
          .flatMap((value: any) => typeof value?.destinationId === 'string' && value.destinationId && !listed.has(value.destinationId) ? [value.destinationId as string] : []))]
        if (importedIds.length > 10_000) throw new Error('More than 10,000 imported conversation receipts; migrate in smaller batches')
        for (const threadId of importedIds) {
          const thread = (await this.rpc('thread/read', { threadId, includeTurns: false }))?.thread
          if (thread?.id !== threadId) throw new Error(`Cannot migrate imported conversation ${threadId}: native summary unavailable`)
          threads.push(thread)
        }
        if (threads.some(t => !Object.prototype.hasOwnProperty.call(t, 'projectId'))) throw new Error('thread/list lacks native projectId; cannot preserve associations during migration')
        const groups = filterGroupsByWorkspaceRoots(normalizeThreadGroupsV2({ data: threads.map(t => ({ ...t, projectId: undefined })), nextCursor: null }), legacy)
        const members = new Map<string, string[]>()
        for (const group of groups) {
          const key = getWorkspaceProjectId(legacy, group.projectName, groups)
          if (key) members.set(key, [...(members.get(key) ?? []), ...group.threads.map(t => t.id)])
        }
        sources = keys.map(key => {
          const remote = legacy.remoteProjects.find(p => p.id === key)
          const root = remote?.remotePath || key
          return { key, name: legacy.labels[key] || remote?.label || toProjectName(root) || key, roots: [{ path: root }],
            threads: members.get(key) ?? [] }
        })
        // Existing native identity is never overwritten by historical path inference.
        // Adopt an exact native project; ambiguous candidates require reconciliation.
        const threadsById = new Map(threads.map(t => [t.id, t]))
        for (const source of sources) {
          const candidates = projects.filter(p => p.name === source.name && JSON.stringify(p.roots) === JSON.stringify(source.roots))
          if (candidates.length > 1) throw new Error(`Multiple native projects match legacy project ${source.key}; reconcile identities before migration`)
          const conflict = source.threads.map(id => threadsById.get(id)).find(t => t?.projectId && t.projectId !== candidates[0]?.id)
          if (conflict) throw new Error(`Legacy project ${source.key} conflicts with thread ${conflict.id}'s native project ${conflict.projectId}; resolve the association before migration`)
        }
      }
      journal = await updateCodexGlobalState(state => {
        const all = state[KEY] as Journals || {}
        all[namespace] ??= { sources }
        state[KEY] = all
        return all[namespace]!
      })
    }
    if (!journal.completed) {
      const migrated: string[] = []
      for (const source of journal.sources) {
        const migrationKey = hash(`${namespace}:${source.key}`)
        const tagged = projects.find(p => p.metadata.codexappMigrationKey === migrationKey)
        const exact = projects.filter(p => p.name === source.name && JSON.stringify(p.roots) === JSON.stringify(source.roots))
        if (!tagged && exact.length > 1) throw new Error(`Ambiguous native identity for ${source.key}; migration stopped`)
        const savedId = journal.destinations?.[source.key]
        let project = savedId ? this.project((await this.rpc('project/read', { projectId: savedId })).project) : tagged || exact[0]
        if (!project) {
          const params: ProjectImportParams = { name: source.name, roots: source.roots, threads: [],
            idempotencyKey: migrationKey, metadata: { codexappMigrationKey: migrationKey } }
          project = this.project((await this.rpc('project/import', params)).project)
        }
        await updateCodexGlobalState(state => {
          const receipt = (state[KEY] as Journals)[namespace]!
          receipt.destinations ??= {}
          receipt.destinations[source.key] = project!.id
        })
        const verified = this.project((await this.rpc('project/read', { projectId: project.id })).project)
        if (verified.name !== source.name || JSON.stringify(verified.roots) !== JSON.stringify(source.roots)) throw new Error('Native project/import did not preserve name/roots; retry after restoring server semantics')
        for (const threadId of source.threads) {
          const thread = (await this.rpc('thread/read', { threadId, includeTurns: false }))?.thread
          if (thread?.projectId === project.id) continue
          if (thread?.projectId) throw new Error(`Thread ${threadId} changed native project during migration; association was not overwritten`)
          const updated = (await this.rpc('thread/metadata/update', { threadId, projectId: project.id }))?.thread
          if (updated?.id !== threadId || updated.projectId !== project.id) throw new Error('thread/metadata/update did not confirm project association')
        }
        migrated.push(project.id)
        if (!projects.some(p => p.id === project!.id)) projects.push(project)
      }
      // Prefix the migrated order, preserving unrelated native projects' order.
      let beforeProjectId = projects.find(p => !migrated.includes(p.id))?.id ?? null
      for (const projectId of [...migrated].reverse()) {
        await this.rpc('project/move', { projectId, beforeProjectId })
        beforeProjectId = projectId
      }
      projects = await this.list()
      if (migrated.some((id, index) => projects[index]?.id !== id)) throw new Error('project/move did not preserve legacy ordering; migration can be retried')
      await updateCodexGlobalState(state => { ((state[KEY] as Journals)[namespace]!).completed = true })
    }
    return { order: [...new Set(projects.flatMap(p => p.roots.map(r => r.path)))], active: [], labels: {},
      projectOrder: projects.map(p => p.id), remoteProjects: [], nativeProjects: projects, projectMode: 'native' }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    const run = previous.catch(() => {}).then(operation)
    this.queue = run.catch(() => {})
    return run
  }

  async register(path: string): Promise<{ path: string; projectId: string }> {
    // Resolve migration before entering the write queue (read itself waits on it).
    const state = await this.read()
    if (!state.nativeProjects) throw new Error(state.projectError)
    return this.mutate(async () => {
      const existing = (await this.list()).find(p => p.roots.some(r => r.path === path))
      const project = existing ?? this.project((await this.rpc('project/create', { name: toProjectName(path), roots: [{ path }],
        idempotencyKey: randomUUID() })).project)
      if (!project.roots.some(r => r.path === path)) throw new Error('project/create did not confirm the requested root')
      return { path, projectId: project.id }
    })
  }

  async operation(operation: { type: 'delete' | 'rename' | 'move'; projectId: string; name?: string; beforeProjectId?: string | null }): Promise<WorkspaceRootsState> {
    const state = await this.read()
    if (!state.nativeProjects) throw new Error(state.projectError)
    if (!state.nativeProjects.some(p => p.id === operation.projectId)) throw new Error('Unknown native project ID')
    await this.mutate(async () => {
      if (operation.type === 'delete') await this.rpc('project/delete', { projectId: operation.projectId })
      if (operation.type === 'rename') {
        const project = this.project((await this.rpc('project/update', { projectId: operation.projectId, name: operation.name })).project)
        if (project.name !== operation.name) throw new Error('project/update did not confirm the requested name')
      }
      if (operation.type === 'move') await this.rpc('project/move', { projectId: operation.projectId, beforeProjectId: operation.beforeProjectId ?? null })
    })
    const updated = await this.read()
    const rows = updated.nativeProjects!
    if (operation.type === 'delete' && rows.some(p => p.id === operation.projectId)) throw new Error('project/delete did not remove the native project')
    if (operation.type === 'move') {
      const index = rows.findIndex(p => p.id === operation.projectId)
      if (index < 0 || (operation.beforeProjectId ? rows[index + 1]?.id !== operation.beforeProjectId : index !== rows.length - 1)) throw new Error('project/move did not confirm the requested ordering')
    }
    return updated
  }
}
