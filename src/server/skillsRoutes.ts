import { readFile, readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

type AppServerLike = {
  rpc(method: string, params: unknown): Promise<unknown>
}

type ReadJsonBody = (req: IncomingMessage) => Promise<unknown>

type SkillRouteContext = {
  appServer: AppServerLike
  readJsonBody: ReadJsonBody
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload instanceof Error && payload.message.trim().length > 0) {
    return payload.message
  }
  const record = asRecord(payload)
  if (!record) return fallback
  const error = record.error
  if (typeof error === 'string' && error.length > 0) return error
  const nestedError = asRecord(error)
  if (nestedError && typeof nestedError.message === 'string' && nestedError.message.length > 0) {
    return nestedError.message
  }
  return fallback
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

function splitAbsolutePath(pathValue: string): string[] {
  return pathValue.split('/').filter(Boolean)
}

function buildAbsolutePath(parts: string[]): string {
  return `/${parts.join('/')}`
}

function normalizeSkillMarkdownPath(skillPath: string): string {
  if (!skillPath) return ''
  return skillPath.endsWith('/SKILL.md') ? skillPath : `${skillPath}/SKILL.md`
}

function deriveSkillPathInfo(
  skillPath: string,
  knownPaths: Set<string> = new Set(),
): {
  normalizedPath: string
  rootSkillPath: string
  rootSkillName: string
  installDir: string
  isNestedSkill: boolean
} | null {
  const normalizedPath = normalizeSkillMarkdownPath(skillPath)
  const parts = splitAbsolutePath(normalizedPath)
  if (parts.length < 2) return null

  const pluginSkillsIndex = parts.lastIndexOf('skills')
  if (pluginSkillsIndex >= 2) {
    const pluginName = parts[pluginSkillsIndex - 2] ?? ''
    if (pluginName) {
      const rootSkillPath = buildAbsolutePath([...parts.slice(0, pluginSkillsIndex + 1), pluginName, 'SKILL.md'])
      if (knownPaths.has(rootSkillPath)) {
        return {
          normalizedPath,
          rootSkillPath,
          rootSkillName: pluginName,
          installDir: buildAbsolutePath(parts.slice(0, pluginSkillsIndex + 1)),
          isNestedSkill: normalizedPath !== rootSkillPath,
        }
      }
    }
  }

  const firstSkillsIndex = parts.indexOf('skills')
  if (firstSkillsIndex < 0 || firstSkillsIndex + 1 >= parts.length - 1) return null
  const rootSkillName = parts[firstSkillsIndex + 1] ?? ''
  if (!rootSkillName) return null
  const rootParts = parts.slice(0, firstSkillsIndex + 2)
  const installDirParts = parts.slice(0, firstSkillsIndex + 1)
  return {
    normalizedPath,
    rootSkillPath: buildAbsolutePath([...rootParts, 'SKILL.md']),
    rootSkillName,
    installDir: buildAbsolutePath(installDirParts),
    isNestedSkill: normalizedPath !== buildAbsolutePath([...rootParts, 'SKILL.md']),
  }
}

function getSkillsInstallDir(): string {
  return join(getCodexHomeDir(), 'skills')
}

type SkillHubEntry = {
  name: string
  owner: string
  description: string
  displayName: string
  publishedAt: number
  avatarUrl: string
  url: string
  installed: boolean
  path?: string
  enabled?: boolean
}

async function buildLocalHubEntry(info: InstalledSkillInfo): Promise<SkillHubEntry> {
  let description = ''
  if (info.path) {
    try {
      description = extractSkillDescriptionFromMarkdown(await readFile(info.path, 'utf8'))
    } catch {}
  }
  return {
    name: info.name,
    owner: 'local',
    description,
    displayName: '',
    publishedAt: 0,
    avatarUrl: '',
    url: '',
    installed: true,
    path: info.path,
    enabled: info.enabled,
  }
}

type RpcSkillRecord = {
  name?: string
  description?: string
  shortDescription?: string
  path?: string
  scope?: string
  enabled?: boolean
}

function groupRpcSkillRecords<T extends RpcSkillRecord>(skills: T[]): T[] {
  const normalizedPathSet = new Set(
    skills
      .map((skill) => normalizeSkillMarkdownPath(typeof skill.path === 'string' ? skill.path : ''))
      .filter(Boolean),
  )
  const grouped = new Map<string, { preferred: T; hasRoot: boolean; anyEnabled: boolean }>()

  for (const skill of skills) {
    const rawPath = typeof skill.path === 'string' ? skill.path : ''
    const pathInfo = rawPath ? deriveSkillPathInfo(rawPath, normalizedPathSet) : null
    const groupingKey = pathInfo && pathInfo.isNestedSkill && normalizedPathSet.has(pathInfo.rootSkillPath)
      ? pathInfo.rootSkillPath
      : (pathInfo?.normalizedPath || rawPath || `${skill.scope ?? ''}:${skill.name ?? ''}`)
    const existing = grouped.get(groupingKey)
    const isRootEntry = pathInfo?.normalizedPath === groupingKey
    const groupedName = pathInfo && groupingKey === pathInfo.rootSkillPath
      ? pathInfo.rootSkillName
      : skill.name

    if (!existing) {
      grouped.set(groupingKey, {
        preferred: isRootEntry
          ? {
              ...skill,
              name: groupedName,
              path: groupingKey,
            }
          : {
              ...skill,
              name: groupedName,
              path: groupingKey,
            },
        hasRoot: isRootEntry,
        anyEnabled: skill.enabled !== false,
      })
      continue
    }

    existing.anyEnabled = existing.anyEnabled || skill.enabled !== false
    if (!existing.hasRoot && isRootEntry) {
      existing.preferred = {
        ...skill,
        name: groupedName,
        path: groupingKey,
      }
      existing.hasRoot = true
      continue
    }
    if (!existing.preferred.description && skill.description) {
      existing.preferred = { ...existing.preferred, description: skill.description }
    }
    if (!existing.preferred.shortDescription && skill.shortDescription) {
      existing.preferred = { ...existing.preferred, shortDescription: skill.shortDescription }
    }
  }

  return Array.from(grouped.values()).map(({ preferred, anyEnabled }) => ({
    ...preferred,
    enabled: preferred.enabled ?? anyEnabled,
  }))
}

type InstalledSkillInfo = { name: string; path: string; enabled: boolean }
async function scanInstalledSkillsFromDir(skillsDir: string): Promise<Map<string, InstalledSkillInfo>> {
  const map = new Map<string, InstalledSkillInfo>()
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillMd = join(skillsDir, entry.name, 'SKILL.md')
      try {
        await stat(skillMd)
        map.set(entry.name, { name: entry.name, path: skillMd, enabled: true })
      } catch {}
    }
  } catch {}
  return map
}

async function scanInstalledSkillsFromDisk(): Promise<Map<string, InstalledSkillInfo>> {
  return await scanInstalledSkillsFromDir(getSkillsInstallDir())
}

async function collectInstalledSkillsMap(appServer: AppServerLike): Promise<Map<string, InstalledSkillInfo>> {
  const installedMap = await scanInstalledSkillsFromDisk()
  try {
    const result = await appServer.rpc('skills/list', {}) as { data?: Array<{ skills?: RpcSkillRecord[] }> }
    for (const entry of result.data ?? []) {
      for (const skill of groupRpcSkillRecords(entry.skills ?? [])) {
        if (skill.name) {
          installedMap.set(skill.name, { name: skill.name, path: skill.path ?? '', enabled: skill.enabled !== false })
        }
      }
    }
  } catch {}
  return installedMap
}

function extractSkillFrontmatterField(markdown: string, fieldName: string): string {
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return ''
  const frontmatter: string[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '---') break
    frontmatter.push(line)
  }
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const fieldPattern = new RegExp(`^${escapedFieldName}\\s*:`, 'iu')
  const valuePattern = new RegExp(`^${escapedFieldName}\\s*:\\s*`, 'iu')
  const fieldLine = frontmatter.find((line) => fieldPattern.test(line.trim()))
  if (!fieldLine) return ''
  return fieldLine.replace(valuePattern, '').replace(/^['"]|['"]$/gu, '').trim()
}

function extractSkillDescriptionFromMarkdown(markdown: string): string {
  const frontmatterDescription = extractSkillFrontmatterField(markdown, 'description')
  if (frontmatterDescription) return frontmatterDescription
  const lines = markdown.split(/\r?\n/)
  let inCodeFence = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence || line.length === 0) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('>')) continue
    if (line.startsWith('- ') || line.startsWith('* ')) continue
    return line
  }
  return ''
}

export async function handleSkillsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: SkillRouteContext,
): Promise<boolean> {
  const { appServer } = context
  if (req.method === 'GET' && url.pathname === '/codex-api/skills-hub') {
    try {
      const installedMap = await collectInstalledSkillsMap(appServer)
      const installed = await Promise.all([...installedMap.values()].map((info) => buildLocalHubEntry(info)))
      installed.sort((a, b) => a.name.localeCompare(b.name))
      setJson(res, 200, { installed })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to fetch skills hub') })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/codex-api/skills-hub/readme') {
    try {
      const owner = url.searchParams.get('owner') || ''
      const name = url.searchParams.get('name') || ''
      const installed = url.searchParams.get('installed') === 'true'
      const skillPath = url.searchParams.get('path') || ''
      if (!owner || !name) {
        setJson(res, 400, { error: 'Missing owner or name' })
        return true
      }
      if (installed) {
        const installedMap = await scanInstalledSkillsFromDisk()
        const installedInfo = installedMap.get(name)
        const localSkillPath = installedInfo?.path
          || (skillPath ? (skillPath.endsWith('/SKILL.md') ? skillPath : `${skillPath}/SKILL.md`) : '')
        if (localSkillPath) {
          const content = await readFile(localSkillPath, 'utf8')
          const description = extractSkillDescriptionFromMarkdown(content)
          setJson(res, 200, { content, description, source: 'local' })
          return true
        }
      }
      setJson(res, 404, { error: 'Only installed local skills are available in Skills Hub.' })
    } catch (error) {
      setJson(res, 502, { error: getErrorMessage(error, 'Failed to fetch SKILL.md') })
    }
    return true
  }

  return false
}
