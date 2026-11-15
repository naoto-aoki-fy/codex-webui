/** Only non-destructive thread/resume operations enter this scheduler. */
export const RECOVERY_DEFAULTS = { concurrency: 3, attempts: 4, deadlineMs: 5_000, budgetMs: 30_000, backoffMs: 500 } as const

type Job = { id: string; params: unknown; attempt: number; started: number; resolve(value: unknown): void; reject(error: Error): void; promise: Promise<unknown>; timer?: ReturnType<typeof setTimeout> }
export class SubscriptionRecovery {
  private jobs = new Map<string, Job>()
  private queue: Job[] = []
  private active = 0
  private epoch = 0
  constructor(private call: (params: unknown, deadlineMs: number) => Promise<unknown>, private status: (id: string, state: string, attempt: number, error?: string) => void) {}
  request(id: string, params: unknown): Promise<unknown> {
    const existing = this.jobs.get(id)
    if (existing) return existing.promise
    let resolve!: Job['resolve'], reject!: Job['reject']
    const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
    const job: Job = { id, params, attempt: 0, started: Date.now(), resolve, reject, promise }
    this.jobs.set(id, job)
    this.queue.push(job)
    this.pump()
    return promise
  }
  parameters(id: string): unknown { return this.jobs.get(id)?.params }
  forget(id: string): void {
    const job=this.jobs.get(id)
    if(!job)return
    clearTimeout(job.timer)
    this.jobs.delete(id)
    this.queue=this.queue.filter(row=>row!==job)
    job.reject(new Error('Subscription recovery invalidated by native thread deletion'))
  }
  cancel(): void {
    this.epoch++
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer)
      job.reject(new Error('Subscription recovery invalidated by disconnect'))
    }
    this.jobs.clear()
    this.queue = []
    this.active = 0
  }
  private pump(): void {
    while (this.active < RECOVERY_DEFAULTS.concurrency && this.queue.length) {
      const job = this.queue.shift()!
      if (this.jobs.get(job.id) !== job) continue
      if (Date.now() - job.started >= RECOVERY_DEFAULTS.budgetMs) {
        this.jobs.delete(job.id)
        const error = new Error('Subscription recovery time budget exhausted')
        this.status(job.id, 'failed', job.attempt, error.message)
        job.reject(error)
        continue
      }
      const epoch = this.epoch
      this.active++
      this.status(job.id, 'recovering', ++job.attempt)
      void this.call(job.params, Math.min(RECOVERY_DEFAULTS.deadlineMs, Math.max(1, RECOVERY_DEFAULTS.budgetMs - (Date.now() - job.started)))).then(result => {
        if (epoch !== this.epoch || this.jobs.get(job.id)!==job) return
        this.jobs.delete(job.id)
        this.status(job.id, 'recovered', job.attempt)
        job.resolve(result)
      }, error => {
        if (epoch !== this.epoch || this.jobs.get(job.id)!==job) return
        const message = error instanceof Error ? error.message : String(error)
        const delay = RECOVERY_DEFAULTS.backoffMs * 2 ** (job.attempt - 1)
        if (job.attempt >= RECOVERY_DEFAULTS.attempts || Date.now() - job.started + delay >= RECOVERY_DEFAULTS.budgetMs) {
          this.jobs.delete(job.id)
          this.status(job.id, 'failed', job.attempt, message)
          job.reject(error instanceof Error ? error : new Error(message))
        } else {
          // Waiting retries do not occupy a worker.
          job.timer = setTimeout(() => { this.queue.push(job); this.pump() }, delay)
          job.timer.unref?.()
        }
      }).finally(() => {
        if (epoch !== this.epoch) return
        this.active--
        this.pump()
      })
    }
  }
}
