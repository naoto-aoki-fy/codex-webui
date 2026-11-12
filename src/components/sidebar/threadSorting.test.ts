import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { UiThread } from '../../types/codex'
import { compareThreads, sortThreadGroups, type ThreadSortMode } from './threadSorting'

function thread(id: string, created: number, updated: number): UiThread {
  return { id, createdAtIso: new Date(created * 1000).toISOString(), updatedAtIso: new Date(updated * 1000).toISOString() } as UiThread
}

const ids = (rows: UiThread[]) => rows.map(row => row.id)

describe('sidebar sorting', () => {
  it('orders projects by their maximum timestamp and threads by the selected field without mutating input', () => {
    const groups = [
      { projectName: 'Alpha', threads: [thread('a', 30, 10)] },
      { projectName: 'Zulu', threads: [thread('z1', 10, 40), thread('z2', 20, 50)] },
    ]
    const updated = sortThreadGroups(groups, 'updated')
    expect(updated.map(group => group.projectName)).toEqual(['Zulu', 'Alpha'])
    expect(ids(updated[0]!.threads)).toEqual(['z2', 'z1'])
    expect(sortThreadGroups(groups, 'created').map(group => group.projectName)).toEqual(['Alpha', 'Zulu'])
    expect(ids(groups[1]!.threads)).toEqual(['z1', 'z2'])
    expect(ids([...groups.flatMap(group => group.threads)].sort(compareThreads('created')))).toEqual(['a', 'z2', 'z1'])
  })

  it('uses stable identifiers for ties and places empty projects last', () => {
    const groups = [
      { projectName: 'Empty Z', threads: [] },
      { projectName: 'Zulu', threads: [thread('b', 10, 10), thread('a', 10, 10)] },
      { projectName: 'Alpha', threads: [thread('c', 10, 10)] },
      { projectName: 'Empty A', threads: [] },
    ]
    for (const mode of ['created', 'updated'] as const) {
      const sorted = sortThreadGroups(groups, mode)
      expect(sorted.map(group => group.projectName)).toEqual(['Alpha', 'Zulu', 'Empty A', 'Empty Z'])
      expect(ids(sorted[1]!.threads)).toEqual(['a', 'b'])
    }
  })

  it('reacts to server metadata refreshes, additional pages, and preference changes', () => {
    const groups = ref([
      { projectName: 'Alpha', threads: [thread('a', 30, 30)] },
      { projectName: 'Zulu', threads: [thread('z', 10, 10)] },
    ])
    const mode = ref<ThreadSortMode>('updated')
    const sorted = computed(() => sortThreadGroups(groups.value, mode.value))
    expect(sorted.value[0]!.projectName).toBe('Alpha')
    groups.value[1]!.threads[0]!.updatedAtIso = new Date(40000).toISOString()
    expect(sorted.value[0]!.projectName).toBe('Zulu')
    groups.value[0]!.threads.push(thread('page2', 20, 50))
    expect(ids(sorted.value[0]!.threads)).toEqual(['page2', 'a'])
    mode.value = 'created'
    expect(ids(sorted.value[0]!.threads)).toEqual(['a', 'page2'])
  })
})
