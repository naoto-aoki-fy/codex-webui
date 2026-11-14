import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

console.log('Welcome to Codex WebUI. github: https://github.com/vast-cow/friuns2-codexapp')

createApp(App).use(router).mount('#app')
