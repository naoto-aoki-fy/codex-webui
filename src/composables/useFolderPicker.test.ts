import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalDirectory, listLocalDirectories, type LocalDirectoryListing } from '../api/codexGateway'
import { useFolderPicker } from './useFolderPicker'

vi.mock('../api/codexGateway', () => ({ createLocalDirectory: vi.fn(), listLocalDirectories: vi.fn() }))
const list = vi.mocked(listLocalDirectories)
const create = vi.mocked(createLocalDirectory)
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
  return { ...useFolderPicker({ resolveStartPath: async () => '/projects', defaultFolderName: () => 'New Project (1)',
    resolveCreationPath: (parent, name) => `${parent}/${name}`, focusPathInput, focusCreateInput }), focusPathInput, focusCreateInput }
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
  it('creates folders within the browsed folder, loads the result and cancels the composer', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await s.onBrowseExistingFolder('/projects/child')
    await s.onOpenCreateFolderPanel(); await nextTick()
    expect(s.focusCreateInput).toHaveBeenCalledOnce()
    s.createFolderDraft.value = 'nested'; create.mockResolvedValue('/projects/child/nested')
    await s.onCreateFolder()
    expect(create).toHaveBeenCalledExactlyOnceWith('/projects/child/nested')
    expect(s.existingFolderBrowsePath.value).toBe('/projects/child/nested')
    expect(s.isCreateFolderOpen.value).toBe(false)
    await s.onOpenCreateFolderPanel(); s.onCloseCreateFolderPanel()
    expect(s.createFolderDraft.value).toBe('')
  })
  it('preserves creation errors and rejects invalid single-folder names', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await s.onOpenCreateFolderPanel()
    s.createFolderDraft.value = '../bad'; await s.onCreateFolder()
    expect(create).not.toHaveBeenCalled(); expect(s.createFolderError.value).toBe('Enter a single folder name.')
    s.createFolderDraft.value = 'valid'; create.mockRejectedValue(new Error('EACCES: permission denied'))
    await s.onCreateFolder()
    expect(s.createFolderError.value).toContain('EACCES')
    expect(s.isCreatingFolder.value).toBe(false); expect(s.isCreateFolderOpen.value).toBe(true)
  })
  it('handles listing permission errors and blocks creation until retry succeeds', async () => {
    list.mockRejectedValueOnce(new Error('EACCES'))
    const s = setup(); await s.onOpenExistingFolder()
    expect(s.existingFolderError.value).toBe('EACCES'); expect(s.canCreateFolder.value).toBe(false)
    s.createFolderDraft.value = 'child'; await s.onCreateFolder()
    expect(create).not.toHaveBeenCalled()
    s.onRetryExistingFolderBrowse(); await nextTick(); expect(s.existingFolderError.value).toBe('')
  })
  it('ignores creation completion after close and reopen', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await s.onOpenCreateFolderPanel()
    const pending = deferred<string>(); create.mockReturnValueOnce(pending.promise)
    const creating = s.onCreateFolder(); s.onCloseExistingFolderPanel(); await s.onOpenExistingFolder()
    pending.resolve('/late'); await creating
    expect(s.existingFolderBrowsePath.value).toBe('/projects'); expect(list).toHaveBeenCalledTimes(2)
    expect(s.isCreateFolderOpen.value).toBe(false)
  })
  it('shows an empty creation result as an error without navigating', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await s.onOpenCreateFolderPanel()
    create.mockResolvedValue(''); await s.onCreateFolder()
    expect(s.createFolderError.value).toBe('Failed to create the folder.')
    expect(list).toHaveBeenCalledTimes(1)
  })
  it('ignores creation failures after closing and successes after navigation', async () => {
    const s = setup(); await s.onOpenExistingFolder(); await s.onOpenCreateFolderPanel()
    const failure = deferred<string>(); create.mockReturnValueOnce(failure.promise)
    const first = s.onCreateFolder(); s.onCloseExistingFolderPanel()
    failure.reject(new Error('late denial')); await first
    expect(s.createFolderError.value).toBe('')
    await s.onOpenExistingFolder(); await s.onOpenCreateFolderPanel()
    const success = deferred<string>(); create.mockReturnValueOnce(success.promise)
    const second = s.onCreateFolder(); await s.onBrowseExistingFolder('/elsewhere')
    success.resolve('/late'); await second
    expect(s.existingFolderBrowsePath.value).toBe('/elsewhere')
    expect(s.isCreatingFolder.value).toBe(false)
  })

})
