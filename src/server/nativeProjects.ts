import { createHash, randomUUID } from 'node:crypto'
import { readCodexGlobalState } from './codexGlobalState.js'
import { workspaceRootsFromPayload, type WorkspaceRootsState } from './workspaceRootsStore.js'
import type { Project } from './protocol/0.167.2/v2/Project.js'
import { toProjectName } from '../pathUtils.js'

const KEY = 'codexapp-native-project-migrations-v1'
type Rpc = (method: string, params: any) => Promise<any>
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Native projects are authoritative. Historical state is inspected only to
 * reject upgrades that have not completed the pre-upgrade migration. */
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
      throw Object.assign(new Error('Native Projects require project/list. Upgrade the connected Codex server; legacy runtime support has ended.'), { cause: error })
    }
    const state = await readCodexGlobalState()
    const legacy = workspaceRootsFromPayload(state)
    const journals = state[KEY] as Record<string, { completed?: boolean }> | undefined
    const journal = journals?.[hash(this.identity())]
    if ((legacy.order.length || legacy.remoteProjects.length || journal) && journal?.completed !== true) {
      throw new Error('Legacy Project migration is incomplete for this connection. Complete migration using the pre-cleanup WebUI before upgrading; see docs/native-project-migration.md. Legacy state has not been changed.')
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
    // Resolve the upgrade guard before entering the write queue.
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
