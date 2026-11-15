import { computed, ref, watch, type Ref } from 'vue'
import { rpcCall, type RpcNotification } from '../api/codexRpcClient'

export type ReviewKind = 'uncommittedChanges' | 'baseBranch' | 'commit' | 'custom'
export function reviewTarget(kind: ReviewKind, value: string) {
  const text = value.trim()
  if (kind === 'uncommittedChanges') return { type: kind }
  if (!text || text.length > 8000) throw new Error('Enter a review target (at most 8,000 characters).')
  if (kind === 'baseBranch') return { type: kind, branch: text }
  if (kind === 'commit') return { type: kind, sha: text }
  return { type: kind, instructions: text }
}

export function createThreadReview(deps: {
  epoch: Ref<number>; selected: Ref<string>; blocked: () => boolean; ready: () => boolean;
  interrupt: (threadId: string, turnId: string) => Promise<void>;
}, request: (method: string, params: unknown) => Promise<unknown> = rpcCall) {
  const kind = ref<ReviewKind>('uncommittedChanges'), value = ref(''), thread = ref(''), turn = ref('')
  const busy = ref(false), cancelling = ref(false), status = ref('')
  let job = 0
  let earlyCompletion: { id: string; status: unknown } | null = null
  const selectedBusy = computed(() => busy.value && thread.value === deps.selected.value)
  watch(deps.epoch, () => {
    job++; cancelling.value = false; earlyCompletion = null
    if (busy.value) {
      busy.value = false
      status.value = 'Connection changed; review outcome unknown. Inspect native history before retrying.'
    }
  }, { flush: 'sync' })
  function finish(outcome: unknown) {
    busy.value = false
    status.value = ['completed', 'failed', 'interrupted'].includes(String(outcome))
      ? `Native review ${outcome}.` : 'Native review completion status unavailable; inspect history.'
  }
  async function run() {
    if (busy.value || !deps.selected.value || deps.blocked() || !deps.ready()) return
    let target
    try { target = reviewTarget(kind.value, value.value) }
    catch (error) { status.value = (error as Error).message; return }
    const token = ++job
    thread.value = deps.selected.value; turn.value = ''; earlyCompletion = null
    busy.value = true; cancelling.value = false; status.value = 'Requesting native inline review…'
    try {
      const result = await request('review/start', { threadId: thread.value, delivery: 'inline', target }) as { reviewThreadId?: unknown; turn?: { id?: unknown } }
      if (token !== job || !busy.value) return
      if (result?.reviewThreadId !== thread.value || typeof result.turn?.id !== 'string' || !result.turn.id) {
        throw new Error('Unrecognized review acknowledgment; inspect native history.')
      }
      turn.value = result.turn.id
      const completed = earlyCompletion as { id: string; status: unknown } | null
      if (completed?.id === turn.value) finish(completed.status)
      else status.value = 'Native review started. Results appear in the conversation.'
    } catch (error) {
      if (token !== job) return
      busy.value = false
      const code = (error as { rpcCode?: number })?.rpcCode
      status.value = code === -32601 ? 'Dedicated review is unsupported by this App Server.'
        : `${typeof code === 'number' ? 'Review rejected.' : 'Review outcome unknown; inspect history before retrying.'} ${error instanceof Error ? error.message : 'Request failed'}`
    }
  }
  function observe(event: RpcNotification) {
    if (!busy.value) return
    const params = event.params as Record<string, any> | null
    if (params?.threadId !== thread.value) return
    if (event.method === 'item/started' && params.item?.type === 'enteredReviewMode' && !turn.value) turn.value = String(params.turnId || '')
    if (event.method === 'turn/completed' && typeof params.turn?.id === 'string') {
      if (turn.value && params.turn.id === turn.value) finish(params.turn.status)
      else if (!turn.value) earlyCompletion = { id: params.turn.id, status: params.turn.status }
    }
  }
  async function cancel() {
    if (!selectedBusy.value || !turn.value || cancelling.value) return
    const token = job
    cancelling.value = true
    try {
      // Use the acknowledged review identity, including before turn/started arrives.
      await deps.interrupt(thread.value, turn.value)
      if (token === job && busy.value) status.value = 'Review interruption requested; waiting for native turn completion.'
    } catch (error) {
      if (token === job && busy.value) status.value = 'Interruption outcome unknown. ' + (error instanceof Error ? error.message : 'Inspect native history.')
    } finally { if (token === job) cancelling.value = false }
  }
  return { kind, value, thread, turn, busy, cancelling, selectedBusy, status, run, observe, cancel }
}
