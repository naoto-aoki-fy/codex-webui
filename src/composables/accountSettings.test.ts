import { beforeEach, expect, it, vi } from 'vitest'
import { rpcCall } from '../api/codexRpcClient'
import { createAccountSettings } from './accountSettings'

vi.mock('../api/codexRpcClient', () => ({ rpcCall: vi.fn() }))

const rpc = vi.mocked(rpcCall)
const signedOut = { account: null, requiresOpenaiAuth: true }
const signedIn = { account: { type: 'chatgpt', email: 'fixture@example.invalid' }, requiresOpenaiAuth: true }
const login = { type: 'chatgpt', loginId: 'fixture', authUrl: 'https://example.invalid/login' }

beforeEach(() => {
  rpc.mockReset().mockImplementation(async method => {
    if (method === 'account/read') return signedOut
    if (method === 'thread/loaded/list') return { data: [], nextCursor: null }
    if (method === 'account/login/start') return login
    if (method === 'account/login/cancel') return { status: 'canceled' }
    if (method === 'account/logout') return {}
    throw new Error(`Unexpected request ${method}`)
  })
})

it('reads account details on demand and coalesces updates behind an in-flight read', async () => {
  const settings = createAccountSettings()
  settings.accountUpdated()
  expect(rpc).not.toHaveBeenCalled()
  let finish!: (value: unknown) => void
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  settings.setActive(true)
  for (let i = 0; i < 5; i++) settings.accountUpdated()
  expect(rpc).toHaveBeenCalledExactlyOnceWith('account/read', { refreshToken: false })
  rpc.mockResolvedValueOnce(signedIn)
  finish(signedOut)
  await vi.waitFor(() => expect(settings.status.value).toEqual(signedIn))
  expect(rpc).toHaveBeenCalledTimes(2)
})

it('handles an early native login completion and ignores completions for other attempts', async () => {
  const settings = createAccountSettings()
  settings.setActive(true)
  await vi.waitFor(() => expect(settings.status.value).toEqual(signedOut))
  let finish!: (value: unknown) => void
  rpc.mockResolvedValueOnce({ data: [], nextCursor: null })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const starting = settings.startLogin('chatgpt', () => true)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  settings.completeLogin({ loginId: 'other', success: true })
  settings.completeLogin({ loginId: 'fixture', success: false, error: 'Sign-in was denied by the App Server' })
  finish(login)
  await starting
  expect(settings.challenge.value).toBeNull()
  expect(settings.actionError.value).toBe('Sign-in was denied by the App Server')
})

it('can cancel a matching native login and logout through the App Server', async () => {
  const settings = createAccountSettings()
  settings.setActive(true)
  await vi.waitFor(() => expect(settings.status.value).toEqual(signedOut))
  await settings.startLogin('chatgpt', () => true)
  expect(settings.challenge.value?.id).toBe('fixture')
  settings.completeLogin({ loginId: 'unrelated', success: true })
  expect(settings.challenge.value?.id).toBe('fixture')
  await settings.cancelLogin()
  expect(rpc).toHaveBeenLastCalledWith('account/login/cancel', { loginId: 'fixture' })
  expect(settings.challenge.value).toBeNull()

  rpc.mockResolvedValueOnce(signedIn)
  await settings.refresh()
  await settings.logout()
  expect(rpc.mock.calls.slice(-2)).toEqual([['account/logout', {}], ['account/read', { refreshToken: false }]])
  expect(settings.status.value).toEqual(signedOut)
})

it('retires account requests and challenges on disconnect and refreshes an open panel on reconnect', async () => {
  const settings = createAccountSettings()
  let finish!: (value: unknown) => void
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  settings.setActive(true)
  settings.disconnect()
  settings.refreshIfActive()
  await vi.waitFor(() => expect(settings.status.value).toEqual(signedOut))
  finish(signedIn)
  await Promise.resolve()
  expect(settings.status.value).toEqual(signedOut)
  await settings.startLogin('chatgpt', () => true)
  settings.disconnect()
  expect(settings.status.value).toBeNull()
  expect(settings.challenge.value).toBeNull()
  expect(rpc.mock.calls.filter(([method]) => method === 'account/login/start')).toHaveLength(1)
})
