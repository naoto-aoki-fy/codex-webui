/** Presentation assets are owned by the web backend, never the App Server. */
export function isAppAssetUrl(value: string): boolean {
  return /^\/codex-app-asset\?id=[a-zA-Z0-9_.%-]+$/u.test(value)
}
