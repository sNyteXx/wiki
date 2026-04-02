/**
 * Apollo Plugin for Vue 3
 *
 * Replacement for vue-apollo (Vue 2) that provides $apollo on component instances.
 * Works with Apollo Client 2.x (apollo-client package).
 */

export default {
  install (app, { apolloClient }) {
    // Provide Apollo client globally
    app.config.globalProperties.$apollo = {
      query: (options) => apolloClient.query(options),
      mutate: (options) => apolloClient.mutate(options),
      subscribe: (options) => apolloClient.subscribe(options),
      getClient: () => apolloClient,
      watchQuery: (options) => apolloClient.watchQuery(options)
    }

    // Also provide for inject
    app.provide('apollo', apolloClient)
  }
}
