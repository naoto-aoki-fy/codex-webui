import { ref } from 'vue'
import { expect, it } from 'vitest'
import { useNativeProjectOptions } from './useNativeProjectOptions'
import type { WorkspaceRootsState } from '../api/normalizers/workspaceRoots'

it('keeps native IDs, names and order even when roots have identical basenames', () => {
  const state = ref<WorkspaceRootsState>({ order: ['/legacy/ignored'], nativeProjects: [
    { id: 'b', name: 'Second', roots: [{ path: '/two/same' }], metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null },
    { id: 'a', name: 'First', roots: [{ path: '/one/same' }], metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null },
  ] })
  const options = useNativeProjectOptions(state)
  expect(options.newThreadFolderOptions.value).toEqual([{ value: 'b', label: 'Second' }, { value: 'a', label: 'First' }])
  expect(options.resolveWorkspaceRootCwd('same')).toBe('')
  expect(options.resolveWorkspaceRootCwd('a')).toBe('/one/same')
  state.value = { order: ['/legacy/ignored'], nativeProjects: [], projectError: 'Unsupported' }
  expect(options.newThreadFolderOptions.value).toEqual([])
  expect(options.removableProjectIds.value).toEqual([])
  expect(state.value.projectError).toBe('Unsupported')
})
