import { randomUUID } from 'node:crypto'
import type { Project } from './protocol/0.167.2/v2/Project.js'
import { toProjectName } from '../pathUtils.js'

type Rpc = (method: string, params: any) => Promise<any>
type WorkspaceRootsState = { order: string[]; nativeProjects: Project[] }

export class NativeProjects {
  private pending?: Promise<WorkspaceRootsState>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly rpc: Rpc) {}

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
      if (!Array.isArray(result?.data) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new Error(`Incompatible ${method} pagination; native Project loading stopped`)
      rows.push(...result.data)
      if (rows.length > 100_000) throw new Error('Native Project listing exceeds 100,000 rows; no partial snapshot is accepted')
      cursor = result.nextCursor
      if (cursor && seen.has(cursor)) throw new Error(`${method} repeated its cursor; native Project loading stopped`)
      if (cursor) seen.add(cursor)
    } while (cursor)
    return rows
  }

  private project(value: any): Project {
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string'
      || !Array.isArray(value.roots) || value.roots.some((r: any) => typeof r?.path !== 'string')
      || !Number.isFinite(value.position) || !value.metadata || typeof value.metadata !== 'object') throw new Error('Incompatible native Project response')
    return value
  }

  private async list(): Promise<Project[]> {
    try {
      return (await this.pages('project/list', { sortKey: 'position', sortDirection: 'asc' })).map(project => this.project(project))
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== -32601) throw error
      throw Object.assign(new Error('Native Projects require project/list. Upgrade the connected Codex server.'), { cause: error })
    }
  }

  private async load(): Promise<WorkspaceRootsState> {
    const nativeProjects = await this.list()
    return {
      order: [...new Set(nativeProjects.flatMap(project => project.roots.map(root => root.path)))],
      nativeProjects,
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    const run = previous.catch(() => {}).then(operation)
    this.queue = run.catch(() => {})
    return run
  }

  async register(path: string): Promise<{ path: string; projectId: string }> {
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
    const rows = updated.nativeProjects
    if (operation.type === 'delete' && rows.some(p => p.id === operation.projectId)) throw new Error('project/delete did not remove the native project')
    if (operation.type === 'move') {
      const index = rows.findIndex(p => p.id === operation.projectId)
      if (index < 0 || (operation.beforeProjectId ? rows[index + 1]?.id !== operation.beforeProjectId : index !== rows.length - 1)) throw new Error('project/move did not confirm the requested ordering')
    }
    return updated
  }
}
