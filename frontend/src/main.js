import './styles/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { reveal } from './directives/reveal'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.directive('reveal', reveal)

app.mount('#app')
