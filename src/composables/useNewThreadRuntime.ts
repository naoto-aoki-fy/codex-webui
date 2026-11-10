import { computed, ref, watch, type Ref } from 'vue'
import { getWorktreeBranchOptions, type WorktreeBranchOption } from '../api/codexGateway'

export function useNewThreadRuntime(cwd: Ref<string>, isGitRepo: Readonly<Ref<boolean>>) {
  const newThreadRuntime = ref<'local' | 'worktree'>('local')
  const newWorktreeBaseBranch = ref('')
  const worktreeBranchOptions = ref<WorktreeBranchOption[]>([])
  const isLoadingWorktreeBranches = ref(false)

  watch(
    () => [newThreadRuntime.value, cwd.value.trim(), isGitRepo.value] as const,
    async ([runtime, sourceCwd, eligible], _previous, onCleanup) => {
      let current = true
      onCleanup(() => { current = false })
      isLoadingWorktreeBranches.value = false
      if (runtime !== 'worktree' || !sourceCwd || !eligible) return

      isLoadingWorktreeBranches.value = true
      try {
        const options = await getWorktreeBranchOptions(sourceCwd)
        if (!current) return
        worktreeBranchOptions.value = options
        const selection = newWorktreeBaseBranch.value.trim()
        if (!selection || !options.some((option) => option.value === selection)) {
          newWorktreeBaseBranch.value = options.find((option) => option.value.trim() === 'main')?.value ?? options[0]?.value ?? ''
        }
      } catch {
        if (!current) return
        worktreeBranchOptions.value = []
        newWorktreeBaseBranch.value = ''
      } finally {
        if (current) isLoadingWorktreeBranches.value = false
      }
    },
    // Invalidate immediately, including when a response is already queued as a microtask.
    { immediate: true, flush: 'sync' },
  )

  const newWorktreeBranchDropdownOptions = computed(() => {
    const selection = newWorktreeBaseBranch.value.trim()
    const options = [...worktreeBranchOptions.value]
    if (selection && !options.some((option) => option.value === selection)) {
      options.unshift({ value: selection, label: selection })
    }
    return options
  })
  const selectedWorktreeBranchLabel = computed(() =>
    newWorktreeBranchDropdownOptions.value.find((option) => option.value === newWorktreeBaseBranch.value.trim())?.label ?? newWorktreeBaseBranch.value.trim(),
  )

  return { newThreadRuntime, newWorktreeBaseBranch, newWorktreeBranchDropdownOptions, selectedWorktreeBranchLabel, isLoadingWorktreeBranches }
}
