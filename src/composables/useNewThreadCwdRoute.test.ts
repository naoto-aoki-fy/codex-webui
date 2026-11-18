import { effectScope, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { useNewThreadCwdRoute } from './useNewThreadCwdRoute'

async function setup(url = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'home', component: {} },
    { path: '/thread/:id', name: 'thread', component: {} },
    { path: '/skills', name: 'skills', component: {} },
  ] })
  const cwd = ref('')
  const scope = effectScope()
  scope.run(() => useNewThreadCwdRoute(router, cwd))
  await router.push(url)
  await router.isReady()
  await Promise.resolve()
  return { router, cwd, scope }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('new thread cwd route', () => {
  it('restores the initial URL after readiness and round-trips special characters', async () => {
    const path = '/tmp/日本語 folder/#a&b'
    const s = await setup('/?cwd=' + encodeURIComponent(path))
    expect(s.cwd.value).toBe(path)
    const replace = vi.spyOn(s.router, 'replace')
    s.cwd.value = path
    await settle()
    expect(replace).not.toHaveBeenCalled()
    s.cwd.value = '/next 日本語 #&'
    await settle()
    expect(s.router.currentRoute.value.query.cwd).toBe(s.cwd.value)
    expect(replace).toHaveBeenCalledTimes(1)
    s.scope.stop()
  })
  it('prioritizes a successful startup folder replacement without a feedback navigation', async () => {
    const s = await setup('/?cwd=/old')
    const replace = vi.spyOn(s.router, 'replace')
    await s.router.replace({ name: 'home', query: { cwd: '/launch 日本語 #&' } })
    await settle()
    expect(s.cwd.value).toBe('/launch 日本語 #&')
    expect(replace).toHaveBeenCalledTimes(1)
    s.scope.stop()
  })
  it('selects, modifies consecutively, and deselects using replace without adding history', async () => {
    const s = await setup('/skills')
    await s.router.push('/')
    const replace = vi.spyOn(s.router, 'replace')
    s.cwd.value = '/one'
    s.cwd.value = '/two'
    s.cwd.value = '/three'
    await settle()
    expect(s.router.currentRoute.value.query.cwd).toBe('/three')
    expect(s.cwd.value).toBe('/three')
    expect(replace).toHaveBeenCalledTimes(3)
    s.cwd.value = ''
    await settle()
    expect(s.router.currentRoute.value.query).toEqual({})
    s.router.back()
    await settle()
    expect(s.router.currentRoute.value.name).toBe('skills')
    s.scope.stop()
  })
  it('restores back/forward entries and ignores selection changes on other routes', async () => {
    const s = await setup('/?cwd=/first')
    await s.router.push('/?cwd=/second')
    expect(s.cwd.value).toBe('/second')
    s.router.back()
    await settle()
    expect(s.cwd.value).toBe('/first')
    s.router.forward()
    await settle()
    expect(s.cwd.value).toBe('/second')
    for (const path of ['/skills', '/thread/123']) {
      await s.router.push(path)
      s.cwd.value = '/elsewhere'
      await settle()
      expect(s.router.currentRoute.value.fullPath).toBe(path)
    }
    await s.router.push({ name: 'home', query: { cwd: '/carried' } })
    expect(s.cwd.value).toBe('/carried')
    await s.router.push('/?cwd=')
    expect(s.cwd.value).toBe('')
    await s.router.push('/')
    expect(s.cwd.value).toBe('')
    s.scope.stop()
  })
  it('replaces a Project selection with a folder route and restores either on navigation', async () => {
    const { router, cwd, scope } = await setup('/?cwd=/project&projectId=explicit')
    await router.push({ name: 'home', query: { cwd: '/project/worktree' } })
    expect(cwd.value).toBe('/project/worktree')
    expect(router.currentRoute.value.query.projectId).toBeUndefined()
    router.back()
    await settle()
    expect(cwd.value).toBe('/project')
    expect(router.currentRoute.value.query.projectId).toBe('explicit')
    router.forward()
    await settle()
    expect(cwd.value).toBe('/project/worktree')
    expect(router.currentRoute.value.query.projectId).toBeUndefined()
    scope.stop()
  })
})
