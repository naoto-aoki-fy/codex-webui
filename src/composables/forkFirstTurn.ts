// turn/start is acceptance, not inference success. Correlate terminal events with
// the returned turn ID, including events delivered before the RPC response.
export class ForkFirstTurn {
  private turnId = ''
  private early = new Map<string, { success: boolean; error: string }>()
  private settled = false

  constructor(private finish: (success: boolean, error: string) => void) {}

  get acceptedTurnId(): string { return this.turnId }

  unresolved(detail: string): void {
    if (this.settled) return
    this.settled = true
    this.finish(false, detail)
  }

  accepted(turnId: string): void {
    this.turnId = turnId
    const outcome = this.early.get(turnId)
    this.early.clear()
    if (outcome) this.complete(turnId, outcome.success, outcome.error)
  }

  complete(turnId: string, success: boolean, error = ''): void {
    if (this.settled || !turnId) return
    if (!this.turnId) {
      // Bound buffering even if the server sends unrelated historical events.
      const previous = this.early.get(turnId)
      if (previous?.success === false) return
      if (previous || this.early.size < 16) this.early.set(turnId, { success, error })
      return
    }
    if (this.turnId !== turnId) return
    this.settled = true
    this.finish(success, error)
  }
}

export function forkRecoveryMessage(draftId: string, detail: string): string {
  return `${detail || 'The first fork turn did not complete successfully.'} The original fork draft is preserved at #/thread/${encodeURIComponent(draftId)}. Open that draft to choose another provider/model. Nothing was automatically replayed; inspect the failed thread for output or tool effects before sending again. If native continuation is unsupported, start a new chat and paste the readable history prefix, labeled "Transferred conversation context". This loses structured reasoning and tool state.`
}
