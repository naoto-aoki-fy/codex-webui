export type GoalTemplate = {
  name: string
  body: string
}

export type SaveGoalTemplateResult = { saved: true } | { saved: false }
