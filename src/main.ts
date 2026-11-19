import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { setInitialConnectionProfile } from './utils/browserConnectionProfile'
import './style.css'

console.log('Welcome to Codex WebUI. github: https://github.com/vast-cow/friuns2-codexapp')

async function mountApp() {
  const response = await fetch('/codex-api/connection-profile')
  if (!response.ok) throw new Error('Could not load the App Server ID')
  const { connectionProfile } = await response.json()
  if (typeof connectionProfile !== 'string' || !connectionProfile) throw new Error('Missing App Server ID')
  setInitialConnectionProfile(connectionProfile)
  createApp(App).use(router).mount('#app')
}

void mountApp().catch(() => {
  const root = document.querySelector('#app')
  if (root) root.textContent = 'Could not load the App Server ID. Reload the page to retry.'
})
