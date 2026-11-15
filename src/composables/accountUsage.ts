import { ref, watch, type Ref } from 'vue'
import { getAccountUsage, type AccountUsage } from '../api/accountUsage'
export function createAccountUsage(epoch: Ref<number>, read = getAccountUsage) {
  const busy = ref(false)
  const loaded = ref(false)
  const data = ref<AccountUsage | null>(null)
  const error = ref('')
  let token = 0
  watch(epoch, () => { token++; busy.value = false; loaded.value = false; data.value = null; error.value = 'Connection changed. Refresh account usage.' }, { flush: 'sync' })
  async function refresh() {
    if (busy.value) return
    const job = ++token
    busy.value = true; error.value = ''; data.value = null; loaded.value = false
    try { const result = await read(); if (job === token) { data.value = result; loaded.value = true } }
    catch (cause) { if (job === token) error.value = (cause as { rpcCode?: number })?.rpcCode === -32601 ? 'Account usage is unsupported by this App Server.' : cause instanceof Error ? cause.message : 'Account usage unavailable' }
    finally { if (job === token) busy.value = false }
  }
  return { busy, loaded, data, error, refresh }
}
