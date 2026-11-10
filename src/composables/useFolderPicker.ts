import { computed, nextTick, ref } from 'vue'
import { createLocalDirectory, listLocalDirectories, type LocalDirectoryEntry } from '../api/codexGateway'
import { getPathParent, normalizePathForUi } from '../pathUtils.js'

interface FolderPickerOptions {
  resolveStartPath: () => Promise<string>
  defaultFolderName: () => string
  resolveCreationPath: (parent: string, name: string) => string
  focusPathInput: () => void
  focusCreateInput: () => void
}

export function useFolderPicker(options: FolderPickerOptions) {
  // Listing generations invalidate results immediately on reload or dismissal.
  let existingFolderBrowseRequestId = 0
  let creationRequestId = 0
  const isCreateFolderOpen = ref(false)
  const createFolderDraft = ref('')
  const createFolderError = ref('')
  const isCreatingFolder = ref(false)
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
  const createFolderParentPath = computed(() => existingFolderBrowsePath.value.trim())
  const isCreateFolderNameValid = computed(() => {
    const draft = createFolderDraft.value.trim()
    if (!draft) return false
    if (draft === '.' || draft === '..') return false
    return !/[\\/]/u.test(draft)
  })
  const canCreateFolder = computed(() => {
    return isCreateFolderNameValid.value && createFolderParentPath.value.trim().length > 0 && !existingFolderError.value
  })
  const resolvedExistingFolderPath = computed(() => {
    const draftedPath = normalizePathForUi(existingFolderPathDraft.value).trim()
    if (draftedPath) return draftedPath
    return existingFolderBrowsePath.value.trim()
  })
  const createFolderSubmitLabel = computed(() => {
    if (isCreatingFolder.value) return 'Creating…'
    return 'Create'
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
    isCreateFolderOpen.value = false
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
    creationRequestId += 1
    isCreatingFolder.value = false
    isExistingFolderPickerOpen.value = false
    isExistingFolderLoading.value = false
    existingFolderError.value = ''
    existingFolderFilter.value = ''
    existingFolderPathDraft.value = ''
    onCloseCreateFolderPanel()
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

  async function onOpenCreateFolderPanel(): Promise<void> {
    createFolderError.value = ''
    if (isCreateFolderOpen.value) {
      onCloseCreateFolderPanel()
      return
    }
    if (!isExistingFolderPickerOpen.value) {
      const startPath = await options.resolveStartPath()
      if (!startPath) return
      isExistingFolderPickerOpen.value = true
      existingFolderFilter.value = ''
      await loadExistingFolderListing(startPath)
      if (existingFolderError.value) return
    }
    if (!isExistingFolderPickerOpen.value || existingFolderError.value) return
    createFolderDraft.value = options.defaultFolderName()
    isCreateFolderOpen.value = true
    void nextTick(() => options.focusCreateInput())
  }

  function onCloseCreateFolderPanel(): void {
    createFolderError.value = ''
    createFolderDraft.value = ''
    isCreateFolderOpen.value = false
  }

  async function onCreateFolder(): Promise<void> {
    if (isCreatingFolder.value || !isExistingFolderPickerOpen.value) return
    const normalizedInput = createFolderDraft.value.trim()
    if (!normalizedInput) return

    createFolderError.value = ''
    if (existingFolderError.value) {
      createFolderError.value = 'Reload the current folder before creating a new one.'
      return
    }
    isCreatingFolder.value = true

    const baseDir = createFolderParentPath.value.trim()
    const targetPath = options.resolveCreationPath(baseDir, normalizedInput)

    if (!targetPath) {
      createFolderError.value = 'Unable to determine where the new folder should be created.'
      isCreatingFolder.value = false
      return
    }

    if (!isCreateFolderNameValid.value) {
      createFolderError.value = 'Enter a single folder name.'
      isCreatingFolder.value = false
      return
    }

    const creationId = ++creationRequestId
    // A creation may finish on disk after dismissal; do not navigate a newer picker session.
    const browseId = existingFolderBrowseRequestId
    const isCurrent = () => creationId === creationRequestId && browseId === existingFolderBrowseRequestId && isExistingFolderPickerOpen.value
    try {
      const normalizedPath = await createLocalDirectory(targetPath)
      if (!isCurrent()) return
      if (!normalizedPath) {
        createFolderError.value = 'Failed to create the folder.'
        return
      }

      createFolderError.value = ''
      existingFolderFilter.value = ''
      await loadExistingFolderListing(normalizedPath)
      if (creationId === creationRequestId && isExistingFolderPickerOpen.value) onCloseCreateFolderPanel()
    } catch (error) {
      if (!isCurrent()) return
      createFolderError.value = error instanceof Error ? error.message : 'Failed to create folder.'
    } finally {
      if (creationId === creationRequestId) isCreatingFolder.value = false
    }
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
      onCloseCreateFolderPanel()
    } finally {
      if (requestId === existingFolderBrowseRequestId) {
        isExistingFolderLoading.value = false
      }
    }
  }

  return {
    isCreateFolderOpen,
    createFolderDraft,
    createFolderError,
    isCreatingFolder,
    isExistingFolderPickerOpen,
    existingFolderPathDraft,
    existingFolderBrowsePath,
    existingFolderError,
    isExistingFolderLoading,
    isOpeningExistingFolder,
    showHiddenFolders,
    existingFolderFilter,
    canCreateFolder,
    resolvedExistingFolderPath,
    createFolderSubmitLabel,
    existingFolderFilteredEntries,
    onOpenExistingFolder,
    onCloseExistingFolderPanel,
    onBrowseExistingFolder,
    onToggleHiddenFolders,
    onRetryExistingFolderBrowse,
    onOpenCreateFolderPanel,
    onCloseCreateFolderPanel,
    onCreateFolder,
  }
}
