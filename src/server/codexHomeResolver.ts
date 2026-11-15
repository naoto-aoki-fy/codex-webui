import { projectPath } from './appServerFileSystem.js'
import { asRecord } from './bridgeHttpUtils.js'

function remotePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\x00-\x1f]/u.test(value) && projectPath(value).isAbsolute(value)
    && !value.split(/[\\/]/u).some(part => part === '.' || part === '..')
}

/** Supported native rollout locations, independent of the home directory name. */
export function sessionCodexHome(value: unknown): string {
  if (!remotePath(value)) return ''
  const path = value.replace(/\\/gu, '/')
  const match = path.match(/\/(?:sessions\/\d{4}\/\d{2}\/\d{2}|archived_sessions)\/rollout-[^/]+\.jsonl$/u)
  if (!match || match.index === undefined) return ''
  const prefix = value.slice(0, match.index)
  const home = !prefix || /^[a-z]:$/iu.test(prefix) ? projectPath(value).parse(value).root : prefix
  return remotePath(home) ? home : ''
}

/** One cache per active connection/profile; no local filesystem access. */
export class CodexHomeResolver {
  private scope: string
  private epoch = {}
  private home = ''
  private pending: Promise<string> | undefined

  constructor(private readonly rpc: (method: string, params: unknown) => Promise<unknown>,
    private readonly activeScope: () => string) {
    this.scope = activeScope()
  }

  reset(): void {
    this.scope = this.activeScope()
    this.epoch = {}
    this.home = ''
    this.pending = undefined
  }

  token(): object {
    if (this.scope !== this.activeScope()) this.reset()
    return this.epoch
  }

  observeInitialization(metadata: unknown, token: object): void {
    if (token !== this.token() || this.home) return
    const home = asRecord(metadata)?.codexHome
    if (remotePath(home)) this.home = home
  }

  observeThreadRead(result: unknown, token: object): void {
    if (token !== this.token() || this.home) return
    this.home = sessionCodexHome(asRecord(asRecord(result)?.thread)?.path)
  }

  resolve(): Promise<string> {
    const token = this.token()
    if (this.home) return Promise.resolve(this.home)
    if (this.pending) return this.pending
    const promise = this.rpc('config/read', { includeLayers: true }).then(result => {
      if (token !== this.token()) throw new Error('Retired Codex home discovery')
      if (this.home) return this.home
      const layers = asRecord(result)?.layers
      if (Array.isArray(layers)) {
        for (const layer of layers) {
          const name = asRecord(asRecord(layer)?.name)
          if (name?.type !== 'user' || !(name.profile === null || name.profile === undefined) || !remotePath(name.file) || /[\\/]$/u.test(name.file)) continue
          this.home = projectPath(name.file).dirname(name.file)
          break
        }
      }
      return this.home
    }).finally(() => {
      if (this.pending === promise) this.pending = undefined
    })
    this.pending = promise
    return promise
  }
}
