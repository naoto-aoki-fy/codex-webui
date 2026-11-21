import { START_LOCATION, type RouteLocationRaw, type Router } from 'vue-router'

export type NewThreadTarget = { cwd: string; projectId?: string }

export function newThreadRoute({ cwd, projectId }: NewThreadTarget): RouteLocationRaw {
  return { name: 'home', query: { ...(projectId ? { projectId } : {}), ...(cwd ? { cwd } : {}) } }
}

export function threadRoute(threadId: string): RouteLocationRaw {
  return { name: 'thread', params: { threadId } }
}

export function sidebarHref(router: Router, location: RouteLocationRaw): string {
  // Both named routes supply all their params. Resolve without tracking the active route.
  return router.resolve(location, START_LOCATION).href
}
