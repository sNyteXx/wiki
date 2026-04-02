import { defineStore } from 'pinia'

export const useAdminStore = defineStore('admin', {
  state: () => ({
    info: {
      currentVersion: 'n/a',
      latestVersion: 'n/a',
      groupsTotal: 0,
      pagesTotal: 0,
      usersTotal: 0
    }
  })
})
