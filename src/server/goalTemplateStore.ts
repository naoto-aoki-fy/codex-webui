import { join } from 'node:path'
import type { GoalTemplate, SaveGoalTemplateResult } from '../goalTemplates.js'
import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'
import { profileStorageDirectory } from './connectionProfile.js'
import { storageNames } from './webuiStorage.mjs'

function isTemplate(value: unknown): value is GoalTemplate {
  if (!value || typeof value !== 'object') return false
  const { name, body } = value as Partial<GoalTemplate>
  return typeof name === 'string' && !!name.trim() && typeof body === 'string' && !!body.trim()
}

function decode(state: Record<string, unknown>): GoalTemplate[] {
  if (state.templates === undefined) return []
  if (!Array.isArray(state.templates) || !state.templates.every(isTemplate)) {
    throw new Error('Invalid saved Goal templates')
  }
  return state.templates
}

export class GoalTemplateStore {
  private readonly path: string

  constructor(connectionProfile: string) {
    this.path = join(profileStorageDirectory('data', connectionProfile), storageNames.goalTemplates)
  }

  async list(): Promise<GoalTemplate[]> {
    return decode(await readCodexGlobalState(this.path))
  }

  async save(template: GoalTemplate, overwrite: boolean): Promise<SaveGoalTemplateResult> {
    return updateCodexGlobalState<SaveGoalTemplateResult>(state => {
      const templates = decode(state)
      const index = templates.findIndex(entry => entry.name === template.name)
      if (index !== -1 && !overwrite) return { saved: false }
      if (index === -1) templates.push(template)
      else templates[index] = template
      state.templates = templates
      return { saved: true }
    }, this.path)
  }

  async delete(name: string): Promise<void> {
    await updateCodexGlobalState(state => {
      const templates = decode(state)
      const index = templates.findIndex(entry => entry.name === name)
      if (index === -1) return
      templates.splice(index, 1)
      state.templates = templates
    }, this.path)
  }
}
