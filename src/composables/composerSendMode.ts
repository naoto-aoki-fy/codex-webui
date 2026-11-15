import { ref, watch, type Ref } from 'vue'

/** Session selection only. Existing conversations continue to reset to Immediate on entry. */
export function createComposerSendMode(context: Ref<string>) {
  const queue = ref(false)
  let createdThread = ''
  watch(context, (next, previous) => {
    const isFirstThreadIdentity = previous === '__new-thread__' && next === createdThread
    if (!isFirstThreadIdentity) queue.value = false
    createdThread = ''
  }, { flush: 'sync' })
  function created(threadId: string) {
    if (context.value === '__new-thread__') createdThread = threadId
  }
  function reset() { createdThread = ''; queue.value = false }
  return { queue, created, reset }
}
