/* global siteConfig */

import { createApp, defineAsyncComponent } from 'vue'
import { createPinia } from 'pinia'
import { ApolloClient } from 'apollo-client'
import { BatchHttpLink } from 'apollo-link-batch-http'
import { ApolloLink, split } from 'apollo-link'
import { WebSocketLink } from 'apollo-link-ws'
import { ErrorLink } from 'apollo-link-error'
import { InMemoryCache } from 'apollo-cache-inmemory'
import { getMainDefinition } from 'apollo-utilities'
import apolloPlugin from './libs/apollo-plugin'
import { createVuetify } from 'vuetify'
import Velocity from 'velocity-animate'
import moment from 'moment-timezone'
import Cookies from 'js-cookie'

import { useMainStore } from './store'
import { useUserStore } from './store/user'
import compatStorePlugin from './libs/compat-store'
import eventBus from './libs/event-bus'
import VueScroll from './libs/vuescroll-stub'

// ====================================
// Load Modules
// ====================================

import boot from './modules/boot'
import localization from './modules/localization'

// ====================================
// Load Helpers
// ====================================

import helpers from './helpers'

// ====================================
// Initialize Global Vars
// ====================================

window.WIKI = null
window.boot = boot
window.eventBus = eventBus

moment.locale(siteConfig.lang)

// ====================================
// Initialize Apollo Client (GraphQL)
// ====================================

const graphQLEndpoint = window.location.protocol + '//' + window.location.host + '/graphql'
const graphQLWSEndpoint = ((window.location.protocol === 'https:') ? 'wss:' : 'ws:') + '//' + window.location.host + '/graphql-subscriptions'

const graphQLLink = ApolloLink.from([
  new ErrorLink(({ graphQLErrors, networkError }) => {
    if (graphQLErrors) {
      let isAuthError = false
      graphQLErrors.map(({ message, locations, path }) => {
        if (message === `Forbidden`) {
          isAuthError = true
        }
        console.error(`[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`)
      })
      const mainStore = useMainStore()
      mainStore.showNotification({
        style: 'red',
        message: isAuthError ? `You are not authorized to access this resource.` : `An unexpected error occurred.`,
        icon: 'alert'
      })
    }
    if (networkError) {
      console.error(networkError)
      const mainStore = useMainStore()
      mainStore.showNotification({
        style: 'red',
        message: `Network Error: ${networkError.message}`,
        icon: 'alert'
      })
    }
  }),
  new BatchHttpLink({
    includeExtensions: true,
    uri: graphQLEndpoint,
    credentials: 'include',
    fetch: async (uri, options) => {
      // Strip __typename fields from variables
      let body = JSON.parse(options.body)
      body = body.map(bd => {
        return ({
          ...bd,
          variables: JSON.parse(JSON.stringify(bd.variables), (key, value) => { return key === '__typename' ? undefined : value })
        })
      })
      options.body = JSON.stringify(body)

      // Inject authentication token
      const jwtToken = Cookies.get('jwt')
      if (jwtToken) {
        options.headers.Authorization = `Bearer ${jwtToken}`
      }

      const resp = await fetch(uri, options)

      // Handle renewed JWT
      const newJWT = resp.headers.get('new-jwt')
      if (newJWT) {
        Cookies.set('jwt', newJWT, { expires: 365, secure: window.location.protocol === 'https:' })
      }
      return resp
    }
  })
])

const graphQLWSLink = new WebSocketLink({
  uri: graphQLWSEndpoint,
  options: {
    reconnect: true,
    lazy: true,
    connectionParams: () => {
      const token = Cookies.get('jwt')
      return token ? { token } : {}
    }
  }
})

window.graphQL = new ApolloClient({
  link: split(({ query }) => {
    const { kind, operation } = getMainDefinition(query)
    return kind === 'OperationDefinition' && operation === 'subscription'
  }, graphQLWSLink, graphQLLink),
  cache: new InMemoryCache(),
  connectToDevTools: (process.env.node_env === 'development')
})

// ====================================
// Bootstrap Vue 3 App
// ====================================

let bootstrap = () => {
  const pinia = createPinia()

  // Create a temporary app to initialize Pinia before mount
  const initApp = createApp({ render: () => null })
  initApp.use(pinia)

  const mainStore = useMainStore()

  window.addEventListener('beforeunload', () => {
    mainStore.startLoading()
  })

  const userStore = useUserStore()
  userStore.refreshAuth()

  const i18n = localization.init()

  let darkModeEnabled = siteConfig.darkMode
  if ((userStore.appearance || '').length > 0) {
    darkModeEnabled = (userStore.appearance === 'dark')
  }

  const vuetify = createVuetify({
    theme: {
      defaultTheme: darkModeEnabled ? 'dark' : 'light'
    },
    defaults: {
      global: {
        ripple: true
      }
    }
  })

  const app = createApp({
    mounted () {
      moment.locale(siteConfig.lang)
      if ((userStore.dateFormat || '').length > 0) {
        moment.updateLocale(moment.locale(), {
          longDateFormat: {
            'L': userStore.dateFormat
          }
        })
      }
      if ((userStore.timezone || '').length > 0) {
        moment.tz.setDefault(userStore.timezone)
      }
    }
  })

  app.use(pinia)
  app.use(vuetify)
  app.use(i18n)
  app.use(helpers)
  app.use(compatStorePlugin)

  // Provide Apollo client
  app.use(apolloPlugin, { apolloClient: window.graphQL })

  // Global properties
  app.config.globalProperties.Velocity = Velocity
  app.config.globalProperties.$moment = moment
  app.config.globalProperties.$eventBus = eventBus

  // ====================================
  // Register Vue Components (async)
  // ====================================

  app.component('Admin', defineAsyncComponent(() => import(/* webpackChunkName: "admin" */ './components/admin.vue')))
  app.component('Comments', defineAsyncComponent(() => import(/* webpackChunkName: "comments" */ './components/comments.vue')))
  app.component('Editor', defineAsyncComponent(() => import(/* webpackPrefetch: -100, webpackChunkName: "editor" */ './components/editor.vue')))
  app.component('History', defineAsyncComponent(() => import(/* webpackChunkName: "history" */ './components/history.vue')))
  app.component('Loader', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "ui-extra" */ './components/common/loader.vue')))
  app.component('Login', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "login" */ './components/login.vue')))
  app.component('NavHeader', defineAsyncComponent(() => import(/* webpackMode: "eager" */ './components/common/nav-header.vue')))
  app.component('NewPage', defineAsyncComponent(() => import(/* webpackChunkName: "new-page" */ './components/new-page.vue')))
  app.component('Notify', defineAsyncComponent(() => import(/* webpackMode: "eager" */ './components/common/notify.vue')))
  app.component('NotFound', defineAsyncComponent(() => import(/* webpackChunkName: "not-found" */ './components/not-found.vue')))
  app.component('PageSelector', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "ui-extra" */ './components/common/page-selector.vue')))
  app.component('PageSource', defineAsyncComponent(() => import(/* webpackChunkName: "source" */ './components/source.vue')))
  app.component('Profile', defineAsyncComponent(() => import(/* webpackChunkName: "profile" */ './components/profile.vue')))
  app.component('Register', defineAsyncComponent(() => import(/* webpackChunkName: "register" */ './components/register.vue')))
  app.component('SearchResults', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "ui-extra" */ './components/common/search-results.vue')))
  app.component('SocialSharing', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "ui-extra" */ './components/common/social-sharing.vue')))
  app.component('Tags', defineAsyncComponent(() => import(/* webpackChunkName: "tags" */ './components/tags.vue')))
  app.component('Unauthorized', defineAsyncComponent(() => import(/* webpackChunkName: "unauthorized" */ './components/unauthorized.vue')))
  app.component('VCardChin', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "ui-extra" */ './components/common/v-card-chin.vue')))
  app.component('VCardInfo', defineAsyncComponent(() => import(/* webpackPrefetch: true, webpackChunkName: "ui-extra" */ './components/common/v-card-info.vue')))
  app.component('Welcome', defineAsyncComponent(() => import(/* webpackChunkName: "welcome" */ './components/welcome.vue')))

  app.component('NavFooter', defineAsyncComponent(() => import(/* webpackChunkName: "theme" */ './themes/' + siteConfig.theme + '/components/nav-footer.vue')))
  app.component('Page', defineAsyncComponent(() => import(/* webpackChunkName: "theme" */ './themes/' + siteConfig.theme + '/components/page.vue')))

  // Register vuescroll replacement
  app.component('VueScroll', VueScroll)

  window.WIKI = app.mount('#root')

  // ----------------------------------
  // Dispatch boot ready
  // ----------------------------------

  window.boot.notify('vue')
}

window.boot.onDOMReady(bootstrap)
