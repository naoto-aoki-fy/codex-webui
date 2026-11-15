import { computed, type Ref } from 'vue'
import type { WorkspaceRootsState } from '../api/normalizers/workspaceRoots'

/** Presentation derives only from the native ordered Project response. */
export function useNativeProjectOptions(state: Ref<WorkspaceRootsState>) {
  const newThreadFolderOptions = computed(() =>
    (state.value.nativeProjects ?? []).map(project => ({ value: project.id, label: project.name })),
  )
  const removableProjectIds = computed(() => (state.value.nativeProjects ?? []).map(project => project.id))
  function resolveWorkspaceRootCwd(projectId: string): string {
    return state.value.nativeProjects?.find(project => project.id === projectId)?.roots[0]?.path || ''
  }
  return { newThreadFolderOptions, removableProjectIds, resolveWorkspaceRootCwd }
}
