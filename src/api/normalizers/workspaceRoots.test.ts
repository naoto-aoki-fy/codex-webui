import { describe, expect, it } from 'vitest'
import { cloneWorkspaceRootsState, normalizeWorkspaceRootsState, type WorkspaceRootsState } from './workspaceRoots'

const empty = () => ({ order: [], labels: {}, active: [], projectOrder: [], remoteProjects: [] })

describe('workspace roots normalization', () => {
  it.each([undefined, null, false, 42, 'root', [], {}, { order: null, labels: [], active: {}, projectOrder: false, remoteProjects: {} }])('defaults missing/malformed fields in %j', (payload) => {
    expect(normalizeWorkspaceRootsState(payload)).toEqual(empty())
  })

  it('deduplicates exact strings before path normalization and preserves ordering and case', () => {
    const paths = [' /b ', '/a', '/b', '/a', '', null, 42, ' ', 'C:\\Root', 'c:\\root', '\\\\?\\C:\\Root']
    const expected = ['/b', '/a', '/b', '', 'C:\\Root', 'c:\\root', 'C:\\Root']
    const result = normalizeWorkspaceRootsState({ order: paths, active: paths, projectOrder: ['remote:id', ...paths] })
    expect(result).toEqual({ ...empty(), order: expected, active: expected, projectOrder: ['remote:id', ...expected] })
  })

  it('normalizes label keys with last collision winning while preserving label whitespace', () => {
    expect(normalizeWorkspaceRootsState({ labels: { ' /a ': ' first ', '/a': ' last ', ' ': 'ignored', '/b': null, '/c': 3 } }).labels).toEqual({ '/a': ' last ' })
  })

  it('copies supported remote metadata, preserves duplicate IDs, and drops unknown fields', () => {
    const remote = Object.freeze({ id: ' remote:id ', hostId: ' host ', remotePath: ' \\\\?\\UNC\\server\\share ', label: ' Label ', extra: { value: true } })
    const payload = Object.freeze({ order: Object.freeze(['/a']), labels: Object.freeze({ '/a': ' A ' }), active: Object.freeze(['/a']), projectOrder: Object.freeze(['remote:id', '/a']), remoteProjects: Object.freeze([remote, null, [], 3, {}, { id: ' ' }, { id: 'remote:id', hostId: null, remotePath: 42, label: false }]), extra: true })
    const first = normalizeWorkspaceRootsState(payload)
    const second = normalizeWorkspaceRootsState(payload)
    expect(first).toEqual({ order: ['/a'], labels: { '/a': ' A ' }, active: ['/a'], projectOrder: ['remote:id', '/a'], remoteProjects: [
      { id: 'remote:id', hostId: 'host', remotePath: '\\\\server\\share', label: 'Label' },
      { id: 'remote:id', hostId: '', remotePath: '', label: '' },
    ] })
    expect(second).toEqual(first)
    for (const key of ['order', 'labels', 'active', 'projectOrder', 'remoteProjects'] as const) {
      expect(first[key]).not.toBe(payload[key])
      expect(second[key]).not.toBe(first[key])
    }
    expect(second.remoteProjects![0]).not.toBe(first.remoteProjects![0])
    expect(payload.remoteProjects[0]).toBe(remote)
    expect(normalizeWorkspaceRootsState(first)).toEqual(first)
  })
})

describe('workspace roots defensive cloning', () => {
  it('isolates all arrays, label records and remote records on every clone', () => {
    const state: WorkspaceRootsState = { order: ['/a'], active: ['/a'], projectOrder: ['r'], labels: { '/a': 'A' }, remoteProjects: [{ id: 'r', hostId: 'h', remotePath: '/p', label: 'R' }] }
    const copy = cloneWorkspaceRootsState(state)
    const again = cloneWorkspaceRootsState(state)
    expect(copy).toEqual(state)
    copy.order.push('/b')
    copy.active.length = 0
    copy.projectOrder.reverse()
    copy.labels['/a'] = 'changed'
    copy.remoteProjects![0]!.label = 'changed'
    copy.remoteProjects!.push({ id: 'new', hostId: '', remotePath: '', label: '' })
    expect(state).toEqual(again)
    for (const key of ['order', 'active', 'projectOrder', 'labels', 'remoteProjects'] as const) expect(copy[key]).not.toBe(again[key])
    expect(copy.remoteProjects![0]).not.toBe(again.remoteProjects![0])
  })

  it('defaults absent remote projects and preserves the existing shallow record boundary', () => {
    expect(cloneWorkspaceRootsState({ order: [], active: [], projectOrder: [], labels: {} })).toEqual(empty())
    const extra = { nested: true }
    const remote = { id: 'r', hostId: '', remotePath: '', label: '', extra }
    const state = { ...empty(), remoteProjects: [remote], extra }
    const clone = cloneWorkspaceRootsState(state)
    expect(clone).not.toHaveProperty('extra')
    expect(clone.remoteProjects![0]).not.toBe(remote)
    expect(clone.remoteProjects![0]).toHaveProperty('extra', extra)
    expect((clone.remoteProjects![0] as typeof remote).extra).toBe(extra)
  })
})
