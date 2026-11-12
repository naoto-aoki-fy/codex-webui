import { computed, nextTick, ref } from 'vue'
import { listLocalDirectories, type LocalDirectoryEntry } from '../api/codexGateway'
import { getPathParent, normalizePathForUi } from '../pathUtils.js'

interface FolderPickerOptions {
  resolveStartPath: () => Promise<string>
  focusPathInput: () => void
}

export function useFolderPicker(options: FolderPickerOptions) {
  // Listing generations invalidate results immediately on reload or dismissal.
  let existingFolderBrowseRequestId = 0
  const isExistingFolderPickerOpen = ref(false)
  const existingFolderPathDraft = ref('')
  const existingFolderBrowsePath = ref('')
  const existingFolderParentPath = ref('')
  const existingFolderEntries = ref<LocalDirectoryEntry[]>([])
  const existingFolderError = ref('')
  const isExistingFolderLoading = ref(false)
  const isOpeningExistingFolder = ref(false)
  const showHiddenFolders = ref(false)
  const existingFolderFilter = ref('')
  const resolvedExistingFolderPath = computed(() => {
    const draftedPath = normalizePathForUi(existingFolderPathDraft.value).trim()
    if (draftedPath) return draftedPath
    return existingFolderBrowsePath.value.trim()
  })
  const canBrowseExistingFolderParent = computed(() => {
    const current = existingFolderBrowsePath.value.trim()
    const parent = existingFolderParentPath.value.trim()
    return Boolean(current && parent && current !== parent)
  })
  const existingFolderDisplayEntries = computed(() => {
    const entries: Array<{ key: string; name: string; path: string; kind: 'parent' | 'directory' }> = []
    if (canBrowseExistingFolderParent.value) {
      entries.push({
        key: `parent:${existingFolderParentPath.value}`,
        name: '..',
        path: existingFolderParentPath.value,
        kind: 'parent',
      })
    }
    for (const entry of existingFolderEntries.value) {
      entries.push({
        key: `directory:${entry.path}`,
        name: entry.name,
        path: entry.path,
        kind: 'directory',
      })
    }
    return entries
  })
  const existingFolderFilteredEntries = computed(() => {
    const filter = existingFolderFilter.value.trim().toLowerCase()
    if (!filter) return existingFolderDisplayEntries.value
    return existingFolderDisplayEntries.value.filter((entry) =>
      entry.kind === 'parent' || entry.name.toLowerCase().includes(filter),
    )
  })
  async function onOpenExistingFolder(): Promise<void> {
    const startPath = await options.resolveStartPath()
    if (!startPath) return
    isExistingFolderPickerOpen.value = true
    existingFolderFilter.value = ''
    const opening = loadExistingFolderListing(startPath)
    const requestId = existingFolderBrowseRequestId
    await opening
    if (requestId === existingFolderBrowseRequestId && isExistingFolderPickerOpen.value && !existingFolderError.value) {
      void nextTick(() => {
        if (requestId === existingFolderBrowseRequestId && isExistingFolderPickerOpen.value) options.focusPathInput()
      })
    }
  }

  function onCloseExistingFolderPanel(): void {
    existingFolderBrowseRequestId += 1
    isExistingFolderPickerOpen.value = false
    isExistingFolderLoading.value = false
    existingFolderError.value = ''
    existingFolderFilter.value = ''
    existingFolderPathDraft.value = ''
  }

  async function onBrowseExistingFolder(path: string): Promise<void> {
    if (!path || isExistingFolderLoading.value) return
    existingFolderFilter.value = ''
    await loadExistingFolderListing(path)
  }

  function onToggleHiddenFolders(): void {
    const currentPath = existingFolderBrowsePath.value.trim()
    if (!isExistingFolderPickerOpen.value || !currentPath) return
    void loadExistingFolderListing(currentPath)
  }

  function onRetryExistingFolderBrowse(): void {
    const currentPath = resolvedExistingFolderPath.value
    if (!isExistingFolderPickerOpen.value || !currentPath || isExistingFolderLoading.value || isOpeningExistingFolder.value) return
    void loadExistingFolderListing(currentPath)
  }

  async function loadExistingFolderListing(path: string): Promise<void> {
    const requestId = ++existingFolderBrowseRequestId
    const normalizedRequestedPath = normalizePathForUi(path).trim()
    existingFolderPathDraft.value = normalizedRequestedPath
    existingFolderBrowsePath.value = normalizedRequestedPath
    existingFolderError.value = ''
    isExistingFolderLoading.value = true

    try {
      const listing = await listLocalDirectories(path, { showHidden: showHiddenFolders.value })
      if (requestId !== existingFolderBrowseRequestId) return
      existingFolderPathDraft.value = listing.path
      existingFolderBrowsePath.value = listing.path
      existingFolderParentPath.value = listing.parentPath
      existingFolderEntries.value = listing.entries
    } catch (error) {
      if (requestId !== existingFolderBrowseRequestId) return
      existingFolderError.value = error instanceof Error ? error.message : 'Failed to load local folders.'
      existingFolderParentPath.value = getPathParent(existingFolderBrowsePath.value)
      existingFolderEntries.value = []
    } finally {
      if (requestId === existingFolderBrowseRequestId) {
        isExistingFolderLoading.value = false
      }
    }
  }

  return {
    isExistingFolderPickerOpen,
    existingFolderPathDraft,
    existingFolderBrowsePath,
    existingFolderError,
    isExistingFolderLoading,
    isOpeningExistingFolder,
    showHiddenFolders,
    existingFolderFilter,
    resolvedExistingFolderPath,
    existingFolderFilteredEntries,
    onOpenExistingFolder,
    onCloseExistingFolderPanel,
    onBrowseExistingFolder,
    onToggleHiddenFolders,
    onRetryExistingFolderBrowse,
  }
}
