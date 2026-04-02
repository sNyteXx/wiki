/**
 * Global event bus using mitt (replacement for Vue 2 this.$root.$on/$off/$emit)
 * In Vue 3, instance event emitter methods ($on, $off, $emit) were removed.
 * This module provides a centralized event bus as a drop-in replacement.
 */

class EventBus {
  constructor () {
    this._listeners = {}
  }

  $on (event, handler) {
    if (!this._listeners[event]) {
      this._listeners[event] = []
    }
    this._listeners[event].push(handler)
  }

  $off (event, handler) {
    if (!this._listeners[event]) return
    if (!handler) {
      delete this._listeners[event]
      return
    }
    this._listeners[event] = this._listeners[event].filter(h => h !== handler)
  }

  $emit (event, ...args) {
    if (!this._listeners[event]) return
    this._listeners[event].forEach(handler => handler(...args))
  }

  $once (event, handler) {
    const wrapper = (...args) => {
      handler(...args)
      this.$off(event, wrapper)
    }
    this.$on(event, wrapper)
  }
}

const eventBus = new EventBus()

export default eventBus
