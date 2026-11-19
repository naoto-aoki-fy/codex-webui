import type { Project } from './server/protocol/0.167.2/v2/Project.js'

export async function listNativeProjects(
  rpc: (method: string, params: unknown) => Promise<unknown>,
): Promise<Project[]> {
  const projects: Project[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const page = await rpc('project/list', { sortKey: 'position', sortDirection: 'asc', limit: 100, cursor }) as {
      data: Project[]
      nextCursor: string | null
    }
    if (!Array.isArray(page?.data) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
      throw new Error('Invalid native project list')
    }
    for (const project of page.data) {
      if (typeof project?.id !== 'string' || !project.id || typeof project.name !== 'string'
        || !Array.isArray(project.roots) || project.roots.some(root => typeof root?.path !== 'string')) {
        throw new Error('Invalid native project')
      }
      projects.push(project)
    }
    cursor = page.nextCursor
    if (projects.length > 100_000 || (cursor && seen.has(cursor))) {
      throw new Error('Native project listing exceeded its pagination bounds')
    }
    if (cursor) seen.add(cursor)
  } while (cursor)
  return projects
}
