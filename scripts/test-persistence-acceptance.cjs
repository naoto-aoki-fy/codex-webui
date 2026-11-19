// Focused acceptance: native IndexedDB transactions; RPC outcomes are fixtures.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const base = 'http://127.0.0.1:4173'
async function check(name, action) { await action(); console.log(`PASS ${name}`) }

async function queueBoundaries(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route('**/persistence-acceptance', route => route.fulfill({ contentType: 'text/html', body: '<title>Persistence acceptance</title>' }))
  await page.goto(`${base}/persistence-acceptance`)
  const rows = await page.evaluate(async () => {
    const { ref, effectScope } = await import('/node_modules/.vite/deps/vue.js')
    const { createNativeQueue } = await import('/src/composables/nativeQueue.ts')
    const records = await import('/src/utils/browserTransactionalRecords.ts')
    const receipts = await import('/src/utils/queueSubmissionReceipts.ts')
    const key = 'codex-web-local.queue-submissions.v1'
    const results = []
    const assert = (condition, message) => { if (!condition) throw new Error(message) }
    for (const mode of ['commit', 'abort-after-success', 'quota', 'request-error', 'wrong-client', 'clear-failure']) {
      await records.updateBrowserRecord(key, {}, () => ({}))
      const nativePut = IDBObjectStore.prototype.put, nativeTransaction = IDBDatabase.prototype.transaction
      const events = [], scope = effectScope(), selected = ref('boundary-thread'), epoch = ref(0)
      let rpcCount = 0, sentClient = '', delayedReply
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = nativeTransaction.apply(this, args)
        if (this.name === 'codex-web-local.persistence.v1' && args[1] === 'readwrite') {
          // Register before production assigns oncomplete so the trace is causal.
          tx.addEventListener('complete', () => events.push('commit'))
          tx.addEventListener('abort', () => events.push('abort'))
        }
        return tx
      }
      IDBObjectStore.prototype.put = function (value, primary) {
        if (primary !== key) return nativePut.apply(this, arguments)
        const reservation = Boolean(value['boundary-thread'])
        if (reservation && mode === 'quota') throw new DOMException('Injected storage quota failure', 'QuotaExceededError')
        const request = reservation && mode === 'request-error' ? this.add(value, primary) : nativePut.apply(this, arguments)
        request.addEventListener('error', () => events.push(`request-error:${request.error?.name}`))
        request.addEventListener('success', () => {
          events.push(reservation ? 'reservation-request-success' : 'clear-request-success')
          if (reservation && mode === 'abort-after-success' || !reservation && mode === 'clear-failure') this.transaction.abort()
        })
        return request
      }
      let owner
      try {
        owner = scope.run(() => createNativeQueue({ selected, epoch, ready: () => true, blocked: () => false }, async (method, params) => {
          if (method === 'thread/queue/list') return { data: [], nextCursor: null }
          rpcCount++; sentClient = params.clientUserMessageId
          assert(events.includes('reservation-request-success') && events.includes('commit'), 'RPC preceded reservation transaction completion')
          events.push('rpc')
          if (mode === 'wrong-client') return new Promise(resolve => { delayedReply = resolve })
          return { queuedSubmission: { id: 'native-entry', clientUserMessageId: sentClient, input: [{ type: 'text', text: 'fixture' }] } }
        }))
        await owner.refresh()
        const pending = owner.add({ text: 'fixture', imageUrls: [], fileAttachments: [], skills: [] })
        let error
        if (mode === 'wrong-client') {
          // Let the real reservation commit while the RPC remains unresolved.
          let settled = false
          pending.then(() => { settled = true }, () => { settled = true })
          const deadline = Date.now() + 5000
          while (!delayedReply && !settled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
          assert(delayedReply, 'Reservation did not reach the delayed RPC')
          assert((await receipts.readQueueSubmissionReceipts())['boundary-thread'] === sentClient, 'Delayed response lost reservation')
          let duplicateRejected = false
          try { await owner.add({ text: 'duplicate', imageUrls: [], fileAttachments: [], skills: [] }) } catch { duplicateRejected = true }
          assert(duplicateRejected && rpcCount === 1, 'Delayed request was sent twice')
          delayedReply({ queuedSubmission: { id: 'wrong-entry', clientUserMessageId: 'different-client', input: [{ type: 'text', text: 'fixture' }] } })
        }
        try { await pending } catch (failure) { error = failure }
        const stored = await receipts.readQueueSubmissionReceipts()
        if (mode === 'commit') {
          assert(!error && rpcCount === 1 && Object.keys(stored).length === 0, 'Successful settlement failed')
          assert(events.indexOf('rpc') > events.indexOf('commit'), 'RPC ran before commit event')
        } else if (['abort-after-success', 'quota', 'request-error'].includes(mode)) {
          assert(error && rpcCount === 0 && Object.keys(stored).length === 0, 'Failed reservation sent RPC or changed committed data')
          if (mode === 'abort-after-success') assert(events.includes('reservation-request-success') && events.includes('abort'), 'Did not abort after request success')
          if (mode === 'quota') assert(error.name === 'QuotaExceededError', 'Wrong quota error')
          if (mode === 'request-error') assert(events.includes('request-error:ConstraintError') && events.includes('abort'), 'Did not exercise a native request error')
        } else {
          assert(error && rpcCount === 1 && stored['boundary-thread'] === sentClient && owner.uncertain.value, 'Uncertain outcome lost its guard')
          epoch.value++; await owner.refresh()
          try { await owner.add({ text: 'retry', imageUrls: [], fileAttachments: [], skills: [] }) } catch { /* Must stay blocked. */ }
          assert(rpcCount === 1, 'Uncertain request replayed')
          const reopenedScope = effectScope()
          try {
            const reopened = reopenedScope.run(() => createNativeQueue({ selected, epoch, ready: () => true, blocked: () => false }, async method => {
              if (method === 'thread/queue/list') return { data: [], nextCursor: null }
              rpcCount++; throw new Error('Unexpected replay')
            }))
            await reopened.refresh()
            let refused = false
            try { await reopened.add({ text: 'after reload', imageUrls: [], fileAttachments: [], skills: [] }) } catch { refused = true }
            assert(refused && rpcCount === 1, 'Owner recreation lost uncertainty guard')
          } finally { reopenedScope.stop() }
        }
        results.push({ mode, events, rpcCount, error: error?.name || null })
      } finally {
        scope.stop()
        IDBObjectStore.prototype.put = nativePut
        IDBDatabase.prototype.transaction = nativeTransaction
      }
    }
    return results
  })
  for (const row of rows) { console.log(JSON.stringify(row)); console.log(`PASS queue/${row.mode}`) }
  await context.close()
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    console.log(`ENGINE ${browser.browserType().name()} ${browser.version()}`)
    await check('queue reservation waits for transaction commit; abort, quota, request error, delayed wrong client and clear failure preserve boundaries', () => queueBoundaries(browser))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
