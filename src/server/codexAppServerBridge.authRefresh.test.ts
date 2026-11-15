import { expect, it, vi } from 'vitest'

it('delivers an explicit error reply to unsupported refresh requests without emitting success', async () => {
  const { AppServerClient } = await import('./appServerClient')
  const client = new AppServerClient({ threadIndex: { call: vi.fn() } })
  const reply = vi.spyOn(client as any, 'sendServerRequestReply').mockImplementation(() => {})
  const notifications = vi.fn(); client.onNotification(notifications)
  try {
    await (client as any).handleServerRequest('request-id', 'account/chatgptAuthTokens/refresh', {})
    expect(reply).toHaveBeenCalledExactlyOnceWith('request-id', { error: {
      code: -32001,
      message: 'Client-managed token refresh is unsupported. Run codex login on the App Server host and use Codex-managed authentication there.',
    } })
    expect(notifications).not.toHaveBeenCalled()
  } finally { client.dispose() }
})
