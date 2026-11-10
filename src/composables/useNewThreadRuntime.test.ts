import { computed, effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorktreeBranchOptions, type WorktreeBranchOption } from '../api/codexGateway'
import { useNewThreadRuntime } from './useNewThreadRuntime'

vi.mock('../api/codexGateway', () => ({ getWorktreeBranchOptions: vi.fn() }))
const request = vi.mocked(getWorktreeBranchOptions)
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach((scope) => scope.stop()); vi.resetAllMocks() })
function setup() {
  const cwd = ref('/a')
  const eligible = ref(true)
  const scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() => useNewThreadRuntime(cwd, eligible))!
  return { ...state, cwd, eligible, scope }
}
function deferred() {
  let resolve!: (options: WorktreeBranchOption[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<WorktreeBranchOption[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const branches = (value: string) => [{ value, label: value }]

describe('new-thread runtime branch ownership', () => {
  it('requests once when cwd also changes computed Git eligibility', async () => {
    request.mockResolvedValue(branches('main'))
    const cwd = ref('/a')
    const statuses = ref<Record<string, boolean>>({ '/a': true, '/b': true })
    const scope = effectScope(); scopes.push(scope)
    const state = scope.run(() => useNewThreadRuntime(cwd, computed(() => statuses.value[cwd.value] === true)))!
    state.newThreadRuntime.value = 'worktree'
    cwd.value = '/b'
    await nextTick()
    expect(request.mock.calls).toEqual([['/a'], ['/b']])
  })
  it('requests branches once per transition into worktree runtime', async () => {
    request.mockResolvedValue(branches('main'))
    const s = setup()
    expect(request).not.toHaveBeenCalled()
    s.newThreadRuntime.value = 'worktree'
    await nextTick()
    expect(request).toHaveBeenCalledExactlyOnceWith('/a')
    expect(s.newWorktreeBaseBranch.value).toBe('main')
  })
  it.each(['success', 'error'] as const)('ignores an older %s while the new cwd is loading', async (outcome) => {
    const a = deferred(); const b = deferred()
    request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const s = setup(); s.newThreadRuntime.value = 'worktree'; s.cwd.value = '/b'
    if (outcome === 'success') a.resolve(branches('old')); else a.reject(new Error('old'))
    await nextTick()
    expect(s.isLoadingWorktreeBranches.value).toBe(true)
    expect(s.newWorktreeBaseBranch.value).toBe('')
    b.resolve(branches('new')); await nextTick()
    expect(s.newWorktreeBaseBranch.value).toBe('new')
    expect(request.mock.calls).toEqual([['/a'], ['/b']])
  })
  it.each(['success', 'error'] as const)('ignores out-of-order %s after the new cwd resolves', async (outcome) => {
    const a = deferred(); const b = deferred()
    request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const s = setup(); s.newThreadRuntime.value = 'worktree'; s.cwd.value = '/b'
    b.resolve(branches('new')); await nextTick()
    if (outcome === 'success') a.resolve(branches('old')); else a.reject(new Error('old'))
    await nextTick()
    expect(s.newWorktreeBranchDropdownOptions.value).toEqual(branches('new'))
    expect(s.newWorktreeBaseBranch.value).toBe('new')
    expect(s.isLoadingWorktreeBranches.value).toBe(false)
  })
  it.each(['local', 'ineligible', 'empty-cwd', 'dispose'])('invalidates active requests on %s', async (change) => {
    const a = deferred(); request.mockReturnValue(a.promise)
    const s = setup(); s.newThreadRuntime.value = 'worktree'
    if (change === 'local') s.newThreadRuntime.value = 'local'
    if (change === 'ineligible') s.eligible.value = false
    if (change === 'empty-cwd') s.cwd.value = ''
    if (change === 'dispose') s.scope.stop()
    const loading = s.isLoadingWorktreeBranches.value
    a.resolve(branches('old')); await nextTick()
    expect(s.newWorktreeBaseBranch.value).toBe('')
    expect(s.isLoadingWorktreeBranches.value).toBe(loading)
  })
  it('does not fetch for non-Git or empty folders and loads when eligibility arrives', async () => {
    request.mockResolvedValue([])
    const s = setup(); s.eligible.value = false; s.newThreadRuntime.value = 'worktree'
    expect(request).not.toHaveBeenCalled()
    s.cwd.value = ''; s.eligible.value = true
    expect(request).not.toHaveBeenCalled()
    s.cwd.value = '/empty-repo'; await nextTick()
    expect(request).toHaveBeenCalledExactlyOnceWith('/empty-repo')
    expect(s.newWorktreeBaseBranch.value).toBe('')
    expect(s.newWorktreeBranchDropdownOptions.value).toEqual([])
  })
  it('preserves valid selections, otherwise prefers main then the first branch', async () => {
    request.mockResolvedValue([...branches('feature'), ...branches('main')])
    const s = setup(); s.newWorktreeBaseBranch.value = 'feature'; s.newThreadRuntime.value = 'worktree'
    await nextTick(); expect(s.newWorktreeBaseBranch.value).toBe('feature')
    s.newThreadRuntime.value = 'local'; s.newWorktreeBaseBranch.value = 'missing'; s.newThreadRuntime.value = 'worktree'
    await nextTick(); expect(s.newWorktreeBaseBranch.value).toBe('main')
    request.mockResolvedValue(branches('other')); s.cwd.value = '/b'
    await nextTick(); expect(s.newWorktreeBaseBranch.value).toBe('other')
    request.mockRejectedValue(new Error('current')); s.cwd.value = '/c'
    await nextTick(); expect(s.newWorktreeBaseBranch.value).toBe('')
    expect(s.newWorktreeBranchDropdownOptions.value).toEqual([])
    expect(s.isLoadingWorktreeBranches.value).toBe(false)
  })
})
