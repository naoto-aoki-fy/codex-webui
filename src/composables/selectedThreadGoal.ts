import { shallowRef, watch, type Ref } from 'vue'
import { clearThreadGoal, getThreadGoal, normalizeThreadGoal, setThreadGoal, type RpcNotification, type ThreadGoal, type ThreadGoalStatus } from '../api/codexGateway'
import { asRecord, readString } from './desktopNotificationReaders'

type TurnOutcome = 'completed' | 'failed' | 'interrupted'
type TurnNotification = {
  // A Goal can be cleared mid-turn. Its current turn still belongs to that Goal.
  goalActive: boolean | undefined
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
  let baselineKnown = false

  function turnState(turnId: string): TurnNotification {
    let turn = turns.get(turnId)
    if (!turn) {
      turn = { goalActive: baselineKnown ? goal.value?.status === 'active' : undefined }
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
    if (turn.outcome === 'failed' || (turn.failed && turn.goalActive === true) ||
      (turn.outcome === 'completed' && turn.goalActive === false) ||
      (turn.outcome === 'interrupted' && turn.goalActive === true)) {
      notifyOnce(turn, turn.pendingSince)
    }
  }

  function establishBaseline(): void {
    if (baselineKnown) return
    baselineKnown = true
    for (const turn of turns.values()) {
      if (turn.goalActive !== undefined) continue
      turn.goalActive = goal.value?.status === 'active'
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
    baselineKnown = false
    loadError.value = ''
    try {
      const result = await getThreadGoal(id)
      if (canApply()) goal.value = result
    } catch (cause) {
      if (!canApply()) return
      goal.value = null
      loadError.value = cause instanceof Error ? cause.message : 'Failed to load goal'
    } finally {
      if (current === baselineRead) {
        loadingBaseline = false
        if (canApply()) establishBaseline()
      }
    }
  }

  function reset(): void {
    selection++
    revision++
    baselineRead++
    loadingBaseline = false
    baselineKnown = false
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
    const isLive = baselineKnown || Boolean(turnId)
    revision++
    goal.value = next
    loadError.value = ''
    if (turn && status === 'active') turn.goalActive = true
    if (isLive && changed && status && status !== 'active') notifyOnce(turn)
    establishBaseline()
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
      if (!baselineKnown && !loadingBaseline) void refresh()
    },
    startTurn(turnId: string) {
      turnState(turnId)
    },
    endTurn(turnId: string, status: unknown) {
      if (status !== 'completed' && status !== 'failed' && status !== 'interrupted') return
      const turn = turnState(turnId)
      if (turn.outcome) return
      turn.outcome = status
      turn.pendingSince = status !== 'failed' && turn.goalActive === undefined ? performance.now() : undefined
      notifyTurnOutcome(turn)
    },
    failActiveGoalTurn(turnId: string) {
      if (!turnId) return
      const turn = turnState(turnId)
      if (turn.outcome) return
      turn.failed = true
      if (turn.goalActive === undefined) turn.pendingSince ??= performance.now()
      notifyTurnOutcome(turn)
    },
  }
}
