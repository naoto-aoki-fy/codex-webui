// Each selectable entry binds a historical writer to a fixed location and
// a validation rule. All entries are opt-in, including the safe ones.
const text = value => typeof value === 'string'
const boolean = value => typeof value === 'boolean'
const integer = Number.isSafeInteger
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const stringMap = value => record(value) && Object.values(value).every(text)

export const fields = (value, checks, required = []) => record(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.entries(value).every(([key, entry]) => Object.hasOwn(checks, key) && checks[key](entry))

const json = validate => raw => {
  try { return validate(JSON.parse(raw)) } catch { return false }
}

const providerState = json(value => fields(value, {
  enabled: boolean, apiKey: key => key === null || text(key), model: text,
  customKey: boolean, personalOpenRouterKey: boolean, customBaseUrl: text,
  provider: value => ['openrouter', 'custom', 'opencode-zen'].includes(value),
  wireApi: value => ['chat', 'responses'].includes(value), providerKeys: stringMap,
}, ['enabled', 'apiKey', 'model']))

const skillsState = json(value => fields(value, {
  githubToken: text, githubUsername: text, repoOwner: text, repoName: text, installedOwners: stringMap,
  lastPullCommitSha: text, lastPushCommitSha: text, lastSyncError: text, lastSyncAtIso: text,
  lastSyncAttemptCount: integer,
}) && Object.keys(value).length > 0)

const inlineTelegram = value => fields(value, { botToken: text }, ['botToken'])
const telegramState = json(value => fields(value, {
  botToken: text,
  completionNotifications: value => fields(value, {
    enabled: boolean, chatIds: value => Array.isArray(value) && value.every(integer), appUrl: text,
  }, ['enabled', 'chatIds', 'appUrl']),
}, ['botToken']))

export const metadataDirectory = 'codexapp-turn-metadata'
export const stagingDirectory = 'codex-web-uploads'

export const legacyRegistry = new Map(Object.entries({
  'cloudflared-prompt-marker': {
    scope: 'shared', policy: 'safe', kind: 'files',
    description: 'Cloudflare installation prompt timestamp',
    provenance: '2e61846 to 21be135 (inherited CLI)',
    files: { '.cloudflared-install-prompted': raw => /^[1-9][0-9]{12}\n$/u.test(raw) },
  },
  'first-launch-plugin-tip': {
    scope: 'legacy-profile', policy: 'safe', kind: 'global-key',
    description: 'Dismissal of the retired WebUI first-launch plugin card',
    provenance: '24ec6c7 to 94cf772',
    key: 'first-launch-plugins-card-dismissed', validate: boolean,
  },
  'generated-webui-password': {
    scope: 'shared', policy: 'acknowledge', kind: 'files',
    description: 'Old generated WebUI password. Older launch records may still refer to it.',
    provenance: '0616844 to d0ff762',
    files: { 'codexui-password': raw => /^[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}\n$/u.test(raw) },
  },
  'provider-state': {
    scope: 'shared', policy: 'acknowledge', kind: 'files',
    description: 'Retired provider settings and potentially unique API keys',
    provenance: 'e560563, 4b6dcd9 and d0c3d50',
    files: { 'webui-free-mode.json': providerState, 'webui-custom-providers.json': providerState },
  },
  'skills-sync-settings': {
    scope: 'shared', policy: 'acknowledge', kind: 'files',
    description: 'Old GitHub Skills sync settings, token and sync history',
    provenance: '661c874 to 1584c9f',
    files: { 'skills-sync.json': skillsState },
  },
  'telegram-inline-settings': {
    scope: 'legacy-profile', policy: 'acknowledge', kind: 'global-key',
    description: 'Old bot token in the mixed global-state file',
    provenance: '84d3832 to bcdf832',
    key: 'telegram-bridge', validate: inlineTelegram,
  },
  'telegram-settings': {
    scope: 'shared', policy: 'acknowledge', kind: 'files',
    description: 'Old Telegram connection settings and bot token',
    provenance: 'bcdf832, 20c7da3 and e01e45e',
    files: { 'telegram-bridge.json': telegramState, 'telegram-bridge.json.tmp': telegramState },
  },
  'review-patches': {
    scope: 'shared', policy: 'acknowledge', kind: 'review-patches', temporary: true,
    description: 'Interrupted Git review patches that may contain unique changes',
    provenance: '3d82d73 to d3d2cf2',
    path: 'codexui-review-patches',
    match: /^[1-9][0-9]{12}-[a-f0-9]*\.patch$/u,
    validate: raw => raw.startsWith('diff --git ') && raw.endsWith('\n'),
  },
  'turn-metadata': {
    scope: 'profile', policy: 'acknowledge', kind: 'turn-metadata',
    description: 'Retired submitted/execution sidecars that can contain unique model and reasoning evidence',
    provenance: 'eff8682 to e1c8ea0, then 109c468 to 9dc2470',
    path: metadataDirectory,
  },
  'staged-uploads': {
    scope: 'shared-or-remote', policy: 'acknowledge', kind: 'staged-uploads', temporary: true,
    description: 'Individually reviewed pre-remote attachments. Removal can break conversation and draft links.',
    provenance: '2f1fb38, friuns2 at 30116bc, backend writer retired by 9b3c7d7',
    path: stagingDirectory,
  },
  'native-project-and-pin-state': {
    scope: 'profile', policy: 'blocked',
    description: 'Native/legacy roots, labels, ordering, pins and migration receipts are shared or needed for startup',
    provenance: '850246b, eff44c6, 3f65904 and c3dac8b',
  },
  'attachment-send-recovery': {
    scope: 'profile', policy: 'blocked',
    description: 'Current attachment-send index may include unresolved sends and older list snapshots',
    provenance: '0d1db25 and c1f2151',
  },
  'portable-fork-records': {
    scope: 'profile', policy: 'blocked',
    description: 'Portable Fork records support display, recovery and duplicate protection',
    provenance: '54f281e and 5123316',
  },
  'thread-title-cache': {
    scope: 'legacy-profile', policy: 'blocked',
    description: 'Mixed Codex.app title cache can hold native and unique titles',
    provenance: '7518a4c to c46878c',
  },
  'deferred-thread-queue': {
    scope: 'legacy-profile', policy: 'blocked',
    description: 'Old deferred queue may contain unresolved submissions and unique unsent messages',
    provenance: 'ab66bab parent bridge',
  },
  'telegram-outbox': {
    scope: 'shared', policy: 'blocked',
    description: 'Old outbox and scratch may contain undelivered text and recovery status',
    provenance: '3fd83e2 to e01e45e',
  },
  'account-archives': {
    scope: 'shared', policy: 'blocked',
    description: 'Old account snapshots contain official Codex credentials',
    provenance: '696372d to e97481c',
  },
  'automations-and-workspaces': {
    scope: 'shared', policy: 'blocked',
    description: 'Automation TOML/memory, worktrees, rollbacks, imports and exports can contain user or native data',
    provenance: 'fa148d0, 1362a7e, c08ab16 and e9cabbe',
  },
  'retired-browser-storage': {
    scope: 'browser', policy: 'manual',
    description: 'Retired WebUI cache, preferences and prompt library records. See the browser inventory.',
    provenance: '74ea66a, d85c80c and 51676cc',
  },
}))
