import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it.each(['zh-CN', 'en', null])('ignores saved language %s and the browser locale', async (saved) => {
  const getItem = vi.fn(() => saved)
  const setItem = vi.fn()
  const documentElement = { lang: 'zh-CN' }
  vi.stubGlobal('document', { documentElement })
  vi.stubGlobal('window', { localStorage: { getItem, setItem } })
  vi.stubGlobal('navigator', { language: 'zh-CN', languages: ['zh-CN'] })

  const language = await import('./useUiLanguage')
  expect(documentElement.lang).toBe('en')
  expect(language.t('Settings')).toBe('Settings')
  expect(language.useUiLanguage()).toEqual({ t: language.t })
  expect(getItem).not.toHaveBeenCalled()
  expect(setItem).not.toHaveBeenCalled()
  expect(language).not.toHaveProperty('setUiLanguage')
})

it('works without a document or access to browser storage', async () => {
  vi.stubGlobal('document', undefined)
  vi.stubGlobal('window', { get localStorage() { throw new Error('Storage unavailable') } })
  const { t } = await import('./useUiLanguage')
  expect(t('Unknown English label')).toBe('Unknown English label')
  expect(t('Installed ({count})', { count: 0 })).toBe('Installed (0)')
  expect(t('{name}: {count}/{count}; {missing}', { name: 'Skills', count: 3 })).toBe('Skills: 3/3; ')
  expect(t('Installed ({count})')).toBe('Installed ({count})')
})
