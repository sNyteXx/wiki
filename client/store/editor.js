import { defineStore } from 'pinia'

export const useEditorStore = defineStore('editor', {
  state: () => ({
    editor: '',
    editorKey: '',
    content: '',
    mode: 'create',
    activeModal: '',
    activeModalData: null,
    media: {
      folderTree: [],
      currentFolderId: 0,
      currentFileId: null
    },
    checkoutDateActive: ''
  }),
  actions: {
    pushMediaFolderTree (folder) {
      this.media.folderTree = this.media.folderTree.concat(folder)
    },
    popMediaFolderTree () {
      this.media.folderTree = this.media.folderTree.slice(0, -1)
    }
  }
})
