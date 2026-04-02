/* eslint-disable import/first */
import { createApp, defineAsyncComponent } from 'vue'
import { createVuetify } from 'vuetify'
import boot from './modules/boot'
/* eslint-enable import/first */

window.WIKI = null
window.boot = boot

let bootstrap = () => {
  const vuetify = createVuetify()

  const app = createApp({})
  app.use(vuetify)

  app.component('setup', defineAsyncComponent(() => import(/* webpackMode: "eager" */ './components/setup.vue')))

  window.WIKI = app.mount('#root')
}

window.boot.onDOMReady(bootstrap)
