import { ref, watch, type Ref } from 'vue'
import { getArchivedThreadGroupsPage } from '../api/codexGateway'
import type { UiThread } from '../types/codex'

export function createArchivedThreads(epoch: Ref<number>, restore: (id: string) => Promise<void>, read = getArchivedThreadGroupsPage) {
  const rows = ref<UiThread[]>([])
  const busy = ref(false)
  const error = ref('')
  const loaded = ref(false)
  const cursor = ref<string | null>(null)
  let job = 0
  watch(epoch, () => { job++; rows.value = []; loaded.value = false; cursor.value = null; busy.value = false; error.value = 'Connection changed. Refresh archived conversations.' }, { flush: 'sync' })
  async function load(more = false) {
    if (busy.value || (more && !cursor.value)) return
    const token = ++job
    busy.value = true
    error.value = ''
    try {
      const previousCursor = more ? cursor.value : null
      const page = await read(previousCursor)
      if (token !== job) return
      if (page.nextCursor && page.nextCursor === previousCursor) throw new Error('Archive pagination did not advance. Refresh to retry.')
      const merged = new Map((more ? rows.value : []).map(row => [row.id, row]))
      for (const row of page.groups.flatMap(group => group.threads)) merged.set(row.id, row)
      rows.value = [...merged.values()]
      cursor.value = page.nextCursor
      loaded.value = true
    } catch (cause) { if (token === job) error.value = cause instanceof Error ? cause.message : 'Cannot load archived conversations' }
    finally { if (token === job) busy.value = false }
  }
  async function restoreRow(id: string) {
    if (busy.value) return
    const token = ++job
    busy.value = true
    error.value = ''
    try {
      await restore(id)
      if (token === job) rows.value = rows.value.filter(row => row.id !== id)
    } catch (cause) { if (token === job) error.value = cause instanceof Error ? cause.message : 'Restore failed; inspect before retrying' }
    finally { if (token === job) busy.value = false }
  }
  return { rows, busy, error, cursor, loaded, load, restoreRow }
}
