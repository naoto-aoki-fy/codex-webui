const { join } = require('node:path')

// Keep fixture processes off the operator's WebUI and Codex directories.
function fixtureWebuiStorage(directory, profile) {
  return {
    CODEXUI_CONNECTION_PROFILE: profile,
    CODEX_HOME: join(directory, 'codex-core'),
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    XDG_STATE_HOME: join(directory, 'state'),
    APPDATA: join(directory, 'roaming'),
    LOCALAPPDATA: join(directory, 'local'),
    ...(process.platform === 'darwin' ? { HOME: directory } : {}),
  }
}

module.exports = { fixtureWebuiStorage }
