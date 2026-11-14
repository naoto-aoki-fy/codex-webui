// The interface is always English, independent of browser or saved preferences.
if (typeof document !== 'undefined') {
  document.documentElement.lang = 'en'
}

export function t(message: string, params?: Record<string, string | number>): string {
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? ''))
}

// Retain the existing call-site API without reactive language state.
export function useUiLanguage() {
  return { t }
}
