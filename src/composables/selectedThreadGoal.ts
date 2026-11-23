import { shallowRef, watch, type Ref } from 'vue'
import { clearThreadGoal, getThreadGoal, normalizeThreadGoal, setThreadGoal, type RpcNotification, type ThreadGoal, type ThreadGoalStatus } from '../api/codexGateway'
import { asRecord, readString } from './desktopNotificationReaders'

type TurnOutcome = 'completed' | 'failed' | 'interrupted'
type GoalActivity = 'active' | 'inactive' | 'pending'
type TurnNotification = {
  // A Goal can be cleared mid-turn. Its current turn still belongs to that Goal.
  goalActivity: GoalActivity
  failed?: boolean
  notified?: boolean
  outcome?: TurnOutcome
  pendingSince?: number
}

export function createSelectedThreadGoal(
  selected: Ref<string>,
  notify: (threadId: string, occurredAt?: number) => void,
  readActiveTurnId: () => string | undefined,
) {
  const goal = shallowRef<ThreadGoal | null>(null)
  const loadError = shallowRef('')
  const turns = new Map<string, TurnNotification>()
  let selection = 0
  let revision = 0
  let baselineRead = 0
  let loadingBaseline = false
  let goalActivity: GoalActivity = 'pending'

  function turnState(turnId: string): TurnNotification {
    let turn = turns.get(turnId)
    if (!turn) {
      turn = { goalActivity }
      turns.set(turnId, turn)
      if (turns.size > 64) turns.delete(turns.keys().next().value!)
    }
    return turn
  }

  function notifyOnce(turn?: TurnNotification, occurredAt?: number): void {
    if (turn?.notified) return
    if (turn) turn.notified = true
    if (occurredAt === undefined) notify(selected.value)
    else notify(selected.value, occurredAt)
  }

  function notifyTurnOutcome(turn: TurnNotification): void {
    if (turn.outcome === 'failed' || (turn.failed && turn.goalActivity === 'active') ||
      (turn.outcome === 'completed' && turn.goalActivity === 'inactive') ||
      (turn.outcome === 'interrupted' && turn.goalActivity === 'active')) {
      notifyOnce(turn, turn.pendingSince)
    }
  }

  function establishBaseline(activity: Exclude<GoalActivity, 'pending'>): void {
    const wasPending = goalActivity === 'pending'
    goalActivity = activity
    if (!wasPending) return
    for (const turn of turns.values()) {
      if (turn.goalActivity !== 'pending') continue
      turn.goalActivity = activity
      notifyTurnOutcome(turn)
    }
  }

  async function refresh(): Promise<void> {
    const id = selected.value
    if (!id) return
    const current = ++baselineRead
    const currentRevision = revision
    const canApply = () => current === baselineRead && currentRevision === revision
    loadingBaseline = true
    goalActivity = 'pending'
    try {
      const result = await getThreadGoal(id)
      if (!canApply()) return
      goal.value = result
      loadError.value = ''
      establishBaseline(result?.status === 'active' ? 'active' : 'inactive')
    } catch (cause) {
      if (!canApply()) return
      loadError.value = cause instanceof Error ? cause.message : 'Failed to load goal'
      console.warn('Failed to load thread goal', cause)
      // Keep the last Goal visible while new turns use ordinary notifications.
      establishBaseline('inactive')
    } finally {
      if (current === baselineRead) loadingBaseline = false
    }
  }

  function reset(): void {
    selection++
    revision++
    baselineRead++
    loadingBaseline = false
    goalActivity = 'pending'
    turns.clear()
    goal.value = null
    loadError.value = ''
  }

  watch(selected, () => {
    reset()
    void refresh()
  }, { flush: 'sync' })

  function update(next: ThreadGoal | null, turnId = ''): void {
    const previousStatus = goal.value?.status
    const status = next?.status
    const relatedId = turnId || readActiveTurnId()
    const turn = relatedId ? turnState(relatedId) : undefined
    const changed = status !== previousStatus
    // Resume snapshots carry no turn ID. The first one establishes state silently.
    const isLive = goalActivity !== 'pending' || Boolean(turnId)
    revision++
    goal.value = next
    loadError.value = ''
    if (turn && status === 'active') turn.goalActivity = 'active'
    if (isLive && changed && status && status !== 'active') notifyOnce(turn)
    establishBaseline(status === 'active' ? 'active' : 'inactive')
  }

  function observe(notification: RpcNotification): boolean {
    if (notification.method !== 'thread/goal/updated' && notification.method !== 'thread/goal/cleared') return false
    const params = asRecord(notification.params)
    if (!selected.value || params?.threadId !== selected.value) return true
    if (notification.method === 'thread/goal/cleared') {
      update(null)
    } else {
      const next = normalizeThreadGoal(params.goal)
      if (next?.threadId === selected.value) update(next, readString(params.turnId))
    }
    return true
  }

  async function save(objective: string, status: ThreadGoalStatus, clear: boolean): Promise<void> {
    const id = selected.value
    const currentSelection = selection
    const currentRevision = revision
    let result: ThreadGoal | null = null
    if (clear) {
      if (!await clearThreadGoal(id)) throw new Error('Failed to clear goal')
    } else {
      result = await setThreadGoal(id, { objective, status })
    }
    if (currentSelection === selection && currentRevision === revision) update(result)
  }

  return {
    goal, loadError, refresh, reset, observe, save,
    ensureBaseline() {
      if (goalActivity === 'pending' && !loadingBaseline) void refresh()
    },
    startTurn(turnId: string) {
      turnState(turnId)
    },
    endTurn(turnId: string, status: unknown) {
      if (status !== 'completed' && status !== 'failed' && status !== 'interrupted') return
      const turn = turnState(turnId)
      if (turn.outcome) return
      turn.outcome = status
      turn.pendingSince = status !== 'failed' && turn.goalActivity === 'pending' ? performance.now() : undefined
      notifyTurnOutcome(turn)
    },
    failActiveGoalTurn(turnId: string) {
      if (!turnId) return
      const turn = turnState(turnId)
      if (turn.outcome) return
      turn.failed = true
      if (turn.goalActivity === 'pending') turn.pendingSince ??= performance.now()
      notifyTurnOutcome(turn)
    },
  }
}
