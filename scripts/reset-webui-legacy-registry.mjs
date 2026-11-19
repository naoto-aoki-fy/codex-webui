// Locations are relative to the selected Codex home or its host's TMPDIR.
// Each deletion rule needs a historical writer and a positive ownership check.
// "acknowledge" marks obsolete state with potentially unique data.
const text = value => typeof value === 'string'
const bool = value => typeof value === 'boolean'
const int = Number.isSafeInteger
const array = validate => value => Array.isArray(value) && value.every(validate)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const hash = '[0-9a-f]{64}'
export const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

function fields(value, checks, required = Object.keys(checks)) {
  return record(value) && required.every(key => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, entry]) => Object.hasOwn(checks, key) && checks[key](entry))
}

export function parseJson(raw) {
  let value
  try { value = JSON.parse(raw) } catch { return undefined }
  // JSON.parse accepts duplicate members. An earlier value could carry data
  // that the writer's schema does not own, even when the last one validates.
  const objects = []
  for (const [token, separator] of raw.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}]/gsu)) {
    if (token === '{') objects.push(new Set())
    else if (token === '}') objects.pop()
    else if (separator && token.endsWith(':')) {
      const key = JSON.parse(separator)
      const seen = objects.at(-1)
      if (seen.has(key)) return undefined
      seen.add(key)
    }
  }
  return value
}

const json = validate => raw => validate(parseJson(raw))
const provider = json(value => fields(value, {
  enabled: bool, apiKey: key => key === null || text(key), model: text,
  customKey: key => bool(key) || text(key), personalOpenRouterKey: bool,
  customBaseUrl: text, customEndpoint: text,
  provider: key => ['openrouter', 'custom', 'opencode-zen'].includes(key),
  wireApi: key => key === 'chat' || key === 'responses',
  providerKeys: keys => record(keys) && Object.values(keys).every(text),
}, ['enabled', 'apiKey', 'model']))

const skills = json(value => fields(value, {
  githubToken: text, githubUsername: text, repoOwner: text, repoName: text,
  installedOwners: owners => record(owners) && Object.values(owners).every(text),
  lastPullCommitSha: text, lastPushCommitSha: text, lastSyncError: text,
  lastSyncAtIso: text, lastSyncAttemptCount: int,
}, []) && Object.keys(value).length > 0)

const telegram = json(value => fields(value, {
  botToken: text, chatIds: array(int), allowedUserIds: array(id => id === '*' || int(id)),
  completionNotifications: entry => fields(entry, { enabled: bool, chatIds: array(int), appUrl: text }),
}, ['botToken']))

const settledOutbox = json(value => fields(value, {
  pending: rows => Array.isArray(rows) && rows.length === 0, settled: array(text), lastError: text,
}))

const pulse = json(value => fields(value, {
  settings: entry => fields(entry, { showInNewChats: bool, referenceMemoryInSuggestions: bool }),
  feedbackHistory: array(entry => fields(entry, {
    id: text, kind: kind => kind === 'curate' || kind === 'feedback', text, createdAtIso: text,
  })),
}))

function generationRow(row, source) {
  return fields(row, {
    turnId: id => text(id) && id.trim().length > 0,
    metadata: entry => {
      const value = item => item === null || (text(item) && item.trim().length > 0)
      return fields(entry, { model: value, effort: value, modelSource: source, effortSource: source }, [])
        && (Object.hasOwn(entry, 'model') || Object.hasOwn(entry, 'effort'))
        && Object.hasOwn(entry, 'model') === Object.hasOwn(entry, 'modelSource')
        && Object.hasOwn(entry, 'effort') === Object.hasOwn(entry, 'effortSource')
    },
  })
}

function sidecar(raw) {
  const rows = raw.split('\n').filter(row => row.trim())
  return raw.endsWith('\n') && rows.length > 0 && rows.every(row =>
    generationRow(parseJson(row), value => value === 'submitted' || value === 'execution'))
}

function rolloutCache(raw, isRolloutPath) {
  return fields(parseJson(raw), {
    version: value => value === 1,
    sourcePath: value => text(value) && isRolloutPath(value),
    modifiedAtMs: value => Number.isFinite(value) && value > 0,
    turns: rows => Array.isArray(rows) && rows.length <= 10_000
      && rows.every(row => generationRow(row, value => value === 'execution')),
  })
}

export const legacyRemoteCache = {
  path: ['cache', 'model-history', 'v1'], scope: 'remote', policy: 'safe',
  match: new RegExp(`^${hash}\\.json$`, 'u'), limit: 2_097_152, validate: rolloutCache,
  writer: '88e5bd9, b156a0e src/server/rolloutGenerationMetadata.ts',
  purpose: 'regenerable WebUI execution metadata cache in a native namespace',
}

export const automationRunId = /^run_[a-z0-9]+_[a-f0-9]{6}$/u
const automationId = value => text(value) && /^automation_[a-z0-9]+_[a-f0-9]{6}$/u.test(value)
const nullableText = value => value === null || text(value)
export const automationStore = json(value => fields(value, {
  version: value => value === 1,
  automations: array(row => fields(row, {
    id: automationId, title: text, prompt: text, projectPaths: array(text), skillNames: array(text),
    enabled: bool, runMode: text, schedulePreset: text, cronExpression: text, model: text,
    reasoningEffort: text, sandboxMode: text, outputSchema: text, resumeThread: bool,
    ephemeral: bool, ignoreUserConfig: bool, ignoreRules: bool, networkAccess: bool,
    webSearchMode: text, approvalPolicy: text, approvalsReviewer: text, autoArchiveEmpty: bool,
    createdAtIso: text, updatedAtIso: text, nextRunAtIso: nullableText, lastRunAtIso: nullableText,
    lastSuccessAtIso: nullableText, lastStatus: text, lastError: text,
  }, ['id', 'title', 'prompt', 'projectPaths', 'enabled'])),
  runs: array(row => fields(row, {
    id: value => text(value) && automationRunId.test(value), automationId, automationTitle: text,
    projectPath: text, cwd: text, effectiveRunMode: text, worktreeCwd: text,
    status: value => ['completed', 'failed', 'archived'].includes(value), unread: bool, archived: bool,
    startedAtIso: text, completedAtIso: nullableText, summary: text, finalMessage: text, error: text,
    outputPath: text, eventLogPath: text, threadId: text, model: text, reasoningEffort: text,
    sandboxMode: text, webSearchMode: text, approvalPolicy: text, approvalsReviewer: text, resumedThreadId: text,
    usage: value => value === null || fields(value, {
      inputTokens: Number.isFinite, cachedInputTokens: Number.isFinite,
      outputTokens: Number.isFinite, reasoningOutputTokens: Number.isFinite,
    }),
    items: array(value => fields(value, { id: text, type: text, title: text, status: text, body: text })),
    structuredResult: () => true, hasFindings: bool,
  }, ['id', 'automationId', 'status'])),
}))

const file = (path, writer, purpose, validate, policy = 'acknowledge') =>
  ({ path, scope: 'shared', writer, purpose, validate, policy })

export const legacyFiles = [
  file('.cloudflared-install-prompted', '2e61846 src/cli/index.ts', 'tunnel installation prompt marker',
    raw => /^[1-9][0-9]{12}\n$/u.test(raw), 'safe'),
  file('codexui-password', '0616844 src/cli/index.ts', 'generated WebUI password',
    raw => /^[a-z0-9]{3}(?:-[a-z0-9]{3}){2}\n$/u.test(raw)),
  file('webui-free-mode.json', 'e560563 src/server/codexAppServerBridge.ts', 'retired provider settings and API keys', provider),
  file('webui-custom-providers.json', '4b6dcd9 src/server/codexAppServerBridge.ts', 'retired provider settings and API keys', provider),
  file('skills-sync.json', '661c874 src/server/codexAppServerBridge.ts', 'retired GitHub Skills sync settings and token', skills),
  file('telegram-bridge.json', 'bf47bcd, 3fd83e2 src/server/codexAppServerBridge.ts', 'retired Telegram settings and bot token', telegram),
  file('telegram-bridge.json.tmp', '3fd83e2 src/server/codexAppServerBridge.ts', 'retired Telegram settings scratch and bot token', telegram),
  file('pulse.json', 'nervmor/codexui ff0f8d6 src/server/codexAppServerBridge.ts', 'retired WebUI Pulse settings and feedback', pulse),
]

export const telegramOutbox = {
  ...file('telegram-notification-outbox.json', '3fd83e2, 4f269e7 src/server/telegramNotificationOutbox.ts',
    'retired Telegram delivery history', settledOutbox),
  scratch: new RegExp(`^telegram-notification-outbox\\.json(?:\\.${uuid})?\\.tmp$`, 'u'),
  locks: ['telegram-notification-outbox.json.lock', 'telegram-notification-outbox.json.worker.lock'],
}

export const legacyKeys = [
  { key: 'first-launch-plugins-card-dismissed', scope: 'legacy', policy: 'safe', validate: bool,
    writer: '24ec6c7 src/server/codexAppServerBridge.ts', purpose: 'dismissal of the retired first-launch card' },
  { key: 'thread-pinned-ids', scope: 'legacy', policy: 'acknowledge', validate: array(text),
    writer: '8dc75bd src/server/codexAppServerBridge.ts', purpose: 'WebUI pins preceding the native pin key' },
  { key: 'telegram-bridge', scope: 'legacy', policy: 'acknowledge', validate: value => fields(value, { botToken: text }),
    writer: '84d3832 src/server/codexAppServerBridge.ts', purpose: 'retired inline Telegram bot token' },
]

export const legacyTrees = {
  patches: {
    path: 'codexui-review-patches', scope: 'shared temporary', policy: 'acknowledge',
    match: /^[1-9][0-9]{12}-[0-9a-f]*\.patch$/u, validate: raw => raw.trimStart().startsWith('diff --git ') && raw.endsWith('\n'),
    writer: '3d82d73 src/server/reviewGit.ts', purpose: 'retired Git review patches that may contain unique edits',
  },
  sidecars: {
    path: 'codexapp-turn-metadata', scope: 'legacy or all-profiles', policy: 'acknowledge',
    match: new RegExp(`^${hash}\\.jsonl$`, 'u'), validate: sidecar, limit: 64 * 1024 * 1024,
    writer: 'eff8682, 109c468 src/server/turnGenerationMetadata.ts', purpose: 'retired turn generation evidence',
  },
  schemas: {
    path: 'codex-web-local-schema-', scope: 'shared temporary', policy: 'safe',
    match: /^codex-web-local-schema-[a-zA-Z0-9]{6}$/u,
    writer: 'fbc8a66 src/server/codexAppServerBridge.ts', purpose: 'generated App Server protocol schema scratch',
  },
  search: {
    path: 'codex-web-local-thread-search-', scope: 'shared temporary', policy: 'safe',
    match: /^codex-web-local-thread-search-[a-zA-Z0-9]{6}$/u,
    writer: 'c6b4f1d src/server/codexAppServerBridge.ts', purpose: 'retired zvec thread search cache',
  },
  automations: {
    path: 'codexui-automations', scope: 'shared', policy: 'acknowledge',
    validate: automationStore,
    writer: 'nervmor/codexui dbbb7cd, 0f66136 src/server/automationRoutes.ts',
    purpose: 'retired standalone WebUI schedules and completed run output',
  },
}

export const protectedLegacy = [
  { scope: 'profile', path: 'global keys thread-titles and thread-queue-state', writer: '7518a4c, ab66bab^',
    purpose: 'mixed thread titles and potentially unsent deferred prompts' },
  { scope: 'shared', path: 'accounts.json and accounts/', writer: '696372d src/server/accountRoutes.ts',
    purpose: 'account switch metadata and official Codex credentials' },
  { scope: 'shared', path: 'automations/', writer: 'fa148d0, 1362a7e src/server/codexAppServerBridge.ts',
    purpose: 'heartbeat/cron definitions and memory in a native Codex namespace' },
  { scope: 'shared', path: 'pulse-today.json', writer: 'nervmor/codexui ff0f8d6 src/server/codexAppServerBridge.ts',
    purpose: 'read-only Pulse feed with unverified producer and ownership' },
  { scope: 'shared temporary', path: 'codexui-account-*/ and codex-skills-{seed,pull,push}-*/', writer: '8b90e98, 661c874, 86c76a9',
    purpose: 'native auth and user Skills, plus Git working copies' },
  { scope: 'shared', path: '.skills-sync-remotes/', writer: '6e45afe src/server/codexAppServerBridge.ts',
    purpose: 'Skills sync Git working copies may contain user data' },
  { scope: 'shared temporary', path: 'codexapp-dev-home-*/', writer: '22c0524 scripts/dev-random-home.cjs',
    purpose: 'temporary development Codex home may contain native data' },
  { scope: 'shared temporary or remote temporary', path: 'codex-web-uploads/', writer: '2f1fb38 src/server/codexAppServerBridge.ts',
    purpose: 'historical staged attachments may still be referenced in native history or drafts' },
  { scope: 'shared', path: 'project files, rollbacks/, prompts/, config.toml, session_index.jsonl, state_5.sqlite',
    writer: 'c08ab16, 4ea0589, a7db33d, 035a465, 12fdc90',
    purpose: 'user-owned and native persistence, including imported chats and project backups' },
  { scope: 'browser', path: 'Local Storage, Session Storage, IndexedDB and cookies',
    writer: 'fbc8a66, a096997, b63525f, d85c80c', purpose: 'browser-owned state covered by the procedure in docs/webui-reset.md' },
  { scope: 'browser', path: 'Firebase Auth and heartbeat records', writer: '86c76a9, 1584c9f^ src/composables/useGithubSkillsSync.ts',
    purpose: 'mixed Firebase stores require verification of the individual WebUI records' },
]
