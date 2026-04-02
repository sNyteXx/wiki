import { defineStore } from 'pinia'
import _ from 'lodash'

export const useMainStore = defineStore('main', {
  state: () => ({
    loadingStack: [],
    notification: {
      message: '',
      style: 'primary',
      icon: 'cached',
      isActive: false
    }
  }),
  getters: {
    isLoading: (state) => state.loadingStack.length > 0
  },
  actions: {
    loadingStart(stackName) {
      this.loadingStack = _.union(this.loadingStack, [stackName])
    },
    loadingStop(stackName) {
      this.loadingStack = _.without(this.loadingStack, stackName)
    },
    showNotification(opts) {
      this.notification = _.defaults(opts, {
        message: '',
        style: 'primary',
        icon: 'cached',
        isActive: true
      })
    },
    updateNotificationState(newState) {
      this.notification.isActive = newState
    },
    pushGraphError(err) {
      this.showNotification({
        style: 'red',
        message: _.get(err, 'graphQLErrors[0].message', err.message),
        icon: 'alert'
      })
    },
    startLoading() {
      this.loadingStart('page')
    }
  }
})
