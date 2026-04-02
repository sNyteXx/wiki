/**
 * Vuex Compatibility Layer for Pinia
 *
 * Provides a $store-like interface that delegates to Pinia stores,
 * enabling gradual migration of components from Vuex to Pinia.
 *
 * Supports:
 * - $store.commit('mutation', payload)  → Pinia action/direct state set
 * - $store.get('module/key')            → Pinia store state (vuex-pathify compat)
 * - $store.set('module/key', value)     → Pinia store state set (vuex-pathify compat)
 * - $store.dispatch('action', payload)  → Pinia action
 * - $store.state.module.key             → Pinia store state
 * - $store.getters['module/key']        → Pinia store getters
 */

import { useMainStore } from '../store/index'
import { useUserStore } from '../store/user'
import { usePageStore } from '../store/page'
import { useSiteStore } from '../store/site'
import { useEditorStore } from '../store/editor'
import { useAdminStore } from '../store/admin'
import _ from 'lodash'

function getStore (moduleName) {
  switch (moduleName) {
    case 'user': return useUserStore()
    case 'page': return usePageStore()
    case 'site': return useSiteStore()
    case 'editor': return useEditorStore()
    case 'admin': return useAdminStore()
    default: return useMainStore()
  }
}

function parseKey (path) {
  const parts = path.split('/')
  if (parts.length === 2) {
    return { module: parts[0], key: parts[1] }
  }
  return { module: null, key: parts[0] }
}

const compatStore = {
  get state () {
    return new Proxy({}, {
      get (target, module) {
        const store = getStore(module)
        return store ? store.$state : undefined
      }
    })
  },
  get getters () {
    return new Proxy({}, {
      get (target, path) {
        const { module, key } = parseKey(path)
        const store = module ? getStore(module) : getStore(null)
        return store[key]
      }
    })
  },
  commit (mutation, payload) {
    // Handle namespaced mutations: 'module/MUTATION_NAME'
    const { module, key } = parseKey(mutation)

    if (module) {
      const store = getStore(module)
      if (!store) {
        console.warn(`[compat-store] Unknown module: ${module}`)
        return
      }
      // Convert SET_KEY mutation to direct state set
      const setMatch = key.match(/^SET_(.+)$/i)
      if (setMatch) {
        const stateKey = _.camelCase(setMatch[1])
        store[stateKey] = payload
        return
      }
      // Try calling as action
      if (typeof store[key] === 'function') {
        store[key](payload)
        return
      }
      // Try camelCase version
      const camelKey = _.camelCase(key)
      if (typeof store[camelKey] === 'function') {
        store[camelKey](payload)
        return
      }
      console.warn(`[compat-store] Unknown mutation: ${mutation}`)
      return
    }

    // Non-namespaced mutations → main store
    const mainStore = useMainStore()
    if (typeof mainStore[mutation] === 'function') {
      mainStore[mutation](payload)
      return
    }
    const camelMutation = _.camelCase(mutation)
    if (typeof mainStore[camelMutation] === 'function') {
      mainStore[camelMutation](payload)
      return
    }
    console.warn(`[compat-store] Unknown mutation: ${mutation}`)
  },
  dispatch (action, payload) {
    const { module, key } = parseKey(action)
    const store = module ? getStore(module) : getStore(null)
    if (store && typeof store[key] === 'function') {
      return store[key](payload)
    }
    const camelKey = _.camelCase(key)
    if (store && typeof store[camelKey] === 'function') {
      return store[camelKey](payload)
    }
    console.warn(`[compat-store] Unknown action: ${action}`)
  },
  // vuex-pathify compatibility: store.get('module/key')
  get (path) {
    const { module, key } = parseKey(path)
    const store = module ? getStore(module) : getStore(null)
    if (!store) return undefined
    return _.get(store.$state, key)
  },
  // vuex-pathify compatibility: store.set('module/key', value)
  set (path, value) {
    const { module, key } = parseKey(path)
    const store = module ? getStore(module) : getStore(null)
    if (!store) {
      console.warn(`[compat-store] Unknown path for set: ${path}`)
      return
    }
    _.set(store, key, value)
  }
}

export default {
  install (app) {
    app.config.globalProperties.$store = compatStore
  }
}

export { compatStore }
