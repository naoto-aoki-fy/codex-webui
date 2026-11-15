import { effectScope, ref } from 'vue'
import { expect, it } from 'vitest'
import { createComposerSendMode } from './composerSendMode'

it('starts Immediate, retains a choice through first identity assignment, and resets on navigation', () => {
  const scope = effectScope()
  scope.run(() => {
    const context = ref('__new-thread__')
    const mode = createComposerSendMode(context)
    expect(mode.queue.value).toBe(false)
    mode.queue.value = true
    mode.created('first')
    context.value = 'first'
    expect(mode.queue.value).toBe(true)
    // Further sends, streaming and management UI do not change context or selection.
    const queuedSubmission = { queue: mode.queue.value, text: 'queued' }
    mode.queue.value = false
    expect(queuedSubmission.queue).toBe(true)
    mode.queue.value = true
    context.value = 'other'
    expect(mode.queue.value).toBe(false)
    mode.queue.value = true
    context.value = 'first'
    expect(mode.queue.value).toBe(false)
    mode.queue.value = true
    context.value = '__new-thread__'
    expect(mode.queue.value).toBe(false)
    mode.queue.value = true
    mode.reset() // New conversation while already on the new-conversation route.
    expect(mode.queue.value).toBe(false)
  })
  scope.stop()
})

it('does not carry a new-thread choice to an unrelated thread', () => {
  const scope = effectScope()
  scope.run(() => {
    const context = ref('__new-thread__')
    const mode = createComposerSendMode(context)
    mode.queue.value = true
    mode.created('created')
    context.value = 'unrelated'
    expect(mode.queue.value).toBe(false)
    context.value = 'created'
    expect(mode.queue.value).toBe(false)
  })
  scope.stop()
})
