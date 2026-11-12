import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listLocalDirectories, type LocalDirectoryListing } from '../api/codexGateway'
import { useFolderPicker } from './useFolderPicker'

vi.mock('../api/codexGateway', () => ({ listLocalDirectories: vi.fn() }))
const list = vi.mocked(listLocalDirectories)
const listing = (path: string, names: string[] = []): LocalDirectoryListing => ({
  path, parentPath: path === '/' ? '/' : '/', entries: names.map((name) => ({ name, path: `${path}/${name}` })),
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const focusPathInput = vi.fn()
  const focusCreateInput = vi.fn()
  return { ...useFolderPicker({ resolveStartPath: async () => '/projects',
    focusPathInput }), focusPathInput, focusCreateInput }
}
beforeEach(() => { vi.resetAllMocks(); list.mockImplementation(async (path) => listing(path)) })

describe('folder picker ownership', () => {
  it('opens with one request, then focuses after rendering', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await nextTick()
    expect(list.mock.calls).toEqual([['/projects', { showHidden: false }]])
    expect(s.isExistingFolderPickerOpen.value).toBe(true)
    expect(s.resolvedExistingFolderPath.value).toBe('/projects')
    expect(s.focusPathInput).toHaveBeenCalledOnce()
    expect(s.isExistingFolderLoading.value).toBe(false)
  })
  it.each(['success', 'error'] as const)('ignores out-of-order %s after hidden reload navigation', async (outcome) => {
    const s = setup(); await s.onOpenExistingFolder()
    const old = deferred<LocalDirectoryListing>(); const current = deferred<LocalDirectoryListing>()
    list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    s.onToggleHiddenFolders()
    s.existingFolderBrowsePath.value = '/new'; s.onToggleHiddenFolders()
    current.resolve(listing('/new', ['winner'])); await nextTick()
    if (outcome === 'success') old.resolve(listing('/old')); else old.reject(new Error('old error'))
    await nextTick()
    expect(s.existingFolderBrowsePath.value).toBe('/new')
    expect(s.existingFolderError.value).toBe('')
    expect(s.isExistingFolderLoading.value).toBe(false)
  })
  it.each(['success', 'error'] as const)('invalidates a pending listing on cancellation (%s)', async (outcome) => {
    const pending = deferred<LocalDirectoryListing>(); list.mockReturnValueOnce(pending.promise)
    const s = setup(); const opening = s.onOpenExistingFolder(); await nextTick()
    s.onCloseExistingFolderPanel()
    if (outcome === 'success') pending.resolve(listing('/late')); else pending.reject(new Error('denied'))
    await opening; await nextTick()
    expect(s.isExistingFolderPickerOpen.value).toBe(false)
    expect(s.existingFolderPathDraft.value).toBe('')
    expect(s.existingFolderError.value).toBe('')
    expect(s.focusPathInput).not.toHaveBeenCalled()
  })
  it('reloads once per hidden toggle and never requests for filtering', async () => {
    list.mockResolvedValue(listing('/', ['Alpha', '.hidden']))
    const s = setup(); await s.onOpenExistingFolder()
    s.showHiddenFolders.value = true; s.onToggleHiddenFolders(); await nextTick()
    expect(list.mock.calls).toEqual([['/projects', { showHidden: false }], ['/', { showHidden: true }]])
    s.existingFolderFilter.value = 'ALP'; expect(s.existingFolderFilteredEntries.value.map((e) => e.name)).toEqual(['Alpha'])
    s.existingFolderFilter.value = 'absent'; expect(s.existingFolderFilteredEntries.value).toEqual([])
    expect(list).toHaveBeenCalledTimes(2)
  })
  it('browses children, preserves parent while filtering, retries typed paths', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await s.onBrowseExistingFolder('/projects/child')
    s.existingFolderFilter.value = 'absent'
    expect(s.existingFolderFilteredEntries.value.map((e) => e.name)).toEqual(['..'])
    s.existingFolderPathDraft.value = '/typed'; s.onRetryExistingFolderBrowse(); await nextTick()
    expect(s.resolvedExistingFolderPath.value).toBe('/typed')
    expect(list).toHaveBeenCalledTimes(3)
  })
})

it('opens without an initial remote path and validates typed paths through the remote listing API', async () => {
  const focus = vi.fn()
  const s = useFolderPicker({ resolveStartPath: async () => '', focusPathInput: focus })
  await s.onOpenExistingFolder()
  expect(s.isExistingFolderPickerOpen.value).toBe(true)
  expect(s.existingFolderError.value).toContain('App Server host')
  expect(list).not.toHaveBeenCalled()
  expect(focus).toHaveBeenCalledOnce()
  list.mockRejectedValueOnce(new Error('Directory not found on remote host'))
  await s.onBrowseExistingFolder('/missing')
  expect(s.existingFolderError.value).toContain('Directory not found')
  await s.onBrowseExistingFolder('D:\\remote\\projects')
  expect(list).toHaveBeenLastCalledWith('D:\\remote\\projects', { showHidden: false })
  expect(s.existingFolderError.value).toBe('')
})
