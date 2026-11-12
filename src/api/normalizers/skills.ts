export type SkillInfo = {
  name: string
  displayName?: string
  description: string
  path: string
  scope: string
  enabled: boolean
}

export function normalizeSkillMarkdownPath(skillPath: string): string {
  if (!skillPath) return ''
  if (typeof skillPath !== 'string') throw new TypeError('Expected skill path string')
  return /[\\/]SKILL\.md$/u.test(skillPath) ? skillPath : `${skillPath}/SKILL.md`
}

export function deriveGroupedSkillRoot(
  skillPath: string,
  knownPaths: Set<string>,
): { rootPath: string; rootName: string; isNested: boolean } | null {
  const normalizedPath = normalizeSkillMarkdownPath(skillPath).replace(/\\/gu, '/')
  const prefix = normalizedPath.startsWith('//') ? '//' : /^[A-Za-z]:\//u.test(normalizedPath) ? '' : '/'
  const parts = normalizedPath.split('/').filter(Boolean)
  const hasKnownPath = (path: string) => knownPaths.has(path) || knownPaths.has(path.replace(/\//gu, '\\'))
  if (parts.length < 2) return null

  const pluginSkillsIndex = parts.lastIndexOf('skills')
  if (pluginSkillsIndex >= 2) {
    const pluginName = parts[pluginSkillsIndex - 2] ?? ''
    if (pluginName) {
      const pluginRootPath = `${prefix}${[...parts.slice(0, pluginSkillsIndex + 1), pluginName, 'SKILL.md'].join('/')}`
      if (hasKnownPath(pluginRootPath)) {
        return { rootPath: pluginRootPath, rootName: pluginName, isNested: pluginRootPath !== normalizedPath }
      }
    }
  }

  const firstSkillsIndex = parts.indexOf('skills')
  if (firstSkillsIndex < 0 || firstSkillsIndex + 1 >= parts.length - 1) return null
  const rootName = parts[firstSkillsIndex + 1] ?? ''
  if (!rootName) return null
  const rootPath = `${prefix}${[...parts.slice(0, firstSkillsIndex + 2), 'SKILL.md'].join('/')}`
  return { rootPath, rootName, isNested: rootPath !== normalizedPath }
}

export type SkillsListResponseEntry = {
  cwd: string
  skills: Array<{
    name: string
    description: string
    shortDescription?: string
    path: string
    scope: string
    enabled: boolean
  }>
  errors: unknown[]
}

export function normalizeSkillsList(entries: SkillsListResponseEntry[]): SkillInfo[] {
  const allSkills = entries.flatMap((entry) => entry.skills)
  const pathByNormalizedPath = new Map(allSkills.map(skill => {
    const path = normalizeSkillMarkdownPath(skill.path)
    return [path.replace(/\\/gu, '/'), path] as const
  }))
  const pathSet = new Set(pathByNormalizedPath.keys())
  const grouped = new Map<string, SkillInfo & { __hasRoot: boolean }>()
  for (const entry of entries) {
    for (const skill of entry.skills) {
      if (!skill.name) continue
      const groupInfo = deriveGroupedSkillRoot(skill.path, pathSet)
      const normalizedPath = normalizeSkillMarkdownPath(skill.path)
      const knownRoot = groupInfo && pathByNormalizedPath.get(groupInfo.rootPath)
      const shouldCollapseIntoRoot = Boolean(groupInfo?.isNested && knownRoot)
      const key = shouldCollapseIntoRoot ? knownRoot! : normalizedPath
      const isRoot = normalizedPath === key
      const existing = grouped.get(key)
      const candidate: SkillInfo & { __hasRoot: boolean } = {
        name: skill.name,
        displayName: groupInfo && key === knownRoot ? groupInfo.rootName : undefined,
        description: skill.shortDescription || skill.description || '',
        path: key,
        scope: skill.scope,
        enabled: skill.enabled,
        __hasRoot: isRoot,
      }
      if (!existing) {
        grouped.set(key, candidate)
        continue
      }
      existing.enabled = existing.enabled || skill.enabled
      if (!existing.__hasRoot && isRoot) {
        grouped.set(key, candidate)
        continue
      }
      if (!existing.displayName && candidate.displayName) {
        existing.displayName = candidate.displayName
      }
      if (!existing.description && candidate.description) {
        existing.description = candidate.description
      }
    }
  }
  return Array.from(grouped.values()).map(({ __hasRoot: _ignored, ...skill }) => skill)
}
