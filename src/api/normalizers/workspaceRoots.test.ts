import { expect, it } from 'vitest'
import { cloneWorkspaceRootsState, normalizeWorkspaceRootsState } from './workspaceRoots'

it('ignores obsolete presentation fields without changing the input record', () => {
  const payload = Object.freeze({ labels: { '/a': 'Legacy' }, active: ['/a'], projectOrder: ['/a'], remoteProjects: [{ id: 'old' }], unknown: true })
  expect(normalizeWorkspaceRootsState(payload)).toEqual({ order: [] })
  expect(payload.unknown).toBe(true)
  expect(payload.active).toEqual(['/a'])
})

it('keeps root ordering for folder navigation and explicit native errors', () => {
  expect(normalizeWorkspaceRootsState({ order: ['/b', '/a', '/b'], nativeProjects: [], projectError: 'Unsupported Projects' }))
    .toEqual({ order: ['/b', '/a'], nativeProjects: [], projectError: 'Unsupported Projects' })
})

it('clones native project roots and metadata before sharing cached state', () => {
  const state = normalizeWorkspaceRootsState({ nativeProjects: [{ id: 'native-id', name: 'Name', roots: [{ path: '/a' }], metadata: { color: 'blue' } }], order: ['/a'] })
  const copy = cloneWorkspaceRootsState(state)
  copy.order.push('/b')
  copy.nativeProjects![0]!.roots[0]!.path = '/changed'
  expect(state.order).toEqual(['/a'])
  expect(state.nativeProjects![0]!.roots[0]!.path).toBe('/a')
  expect(copy.nativeProjects![0]!.metadata).not.toBe(state.nativeProjects![0]!.metadata)
})

it.each([undefined, null, false, 42, 'root', [], {}, { order: null }])('defaults missing or malformed root data in %j', payload => {
  expect(normalizeWorkspaceRootsState(payload)).toEqual({ order: [] })
})

it('deduplicates exact roots before normalizing paths and preserves ordering and case', () => {
  const order = [' /b ', '/a', '/b', '/a', '', null, 42, ' ', 'C:\\Root', 'c:\\root', '\\\\?\\C:\\Root']
  const expected = ['/b', '/a', '/b', '', 'C:\\Root', 'c:\\root', 'C:\\Root']
  expect(normalizeWorkspaceRootsState({ order }).order).toEqual(expected)
})
