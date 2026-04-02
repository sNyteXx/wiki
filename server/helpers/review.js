const _ = require('lodash')
const uslug = require('uslug')
const { customAlphabet } = require('nanoid/non-secure')

/* global WIKI */

const nanoid = customAlphabet('1234567890abcdef', 8)

module.exports = {
  getConfig() {
    return {
      rootLocale: _.get(WIKI.config, 'review.rootLocale', 'de'),
      rootPath: this.normalizePath(_.get(WIKI.config, 'review.rootPath', 'Entwuerfe/Review')),
      forceMarkdown: _.get(WIKI.config, 'review.forceMarkdown', true),
      blockUploads: _.get(WIKI.config, 'review.blockUploads', true),
      hideDraftsFromSearch: _.get(WIKI.config, 'review.hideDraftsFromSearch', true)
    }
  },
  getRootLocale() {
    return this.getConfig().rootLocale
  },
  getRootPath() {
    return this.getConfig().rootPath
  },
  getRootPage() {
    return {
      locale: this.getRootLocale(),
      path: this.getRootPath()
    }
  },
  normalizePath(path = '') {
    return _.trim(_.toString(path), '/')
  },
  sanitizeTitle(title = '') {
    const clean = uslug(_.trim(title)) || 'review-draft'
    return _.truncate(clean, {
      length: 80,
      omission: ''
    }) || 'review-draft'
  },
  buildReviewPath(title = '') {
    return `${this.getRootPath()}/${this.sanitizeTitle(title)}-${nanoid().toLowerCase()}`
  },
  isAuthenticatedUser(user) {
    const userId = _.toSafeInteger(_.get(user, 'id', 0))
    return userId > 0 && userId !== 2
  },
  canCreateReviewDraft(user) {
    return this.isAuthenticatedUser(user)
  },
  isReviewPath(path = '', locale = '') {
    const normPath = this.normalizePath(path)
    return locale === this.getRootLocale() &&
      (normPath === this.getRootPath() || _.startsWith(normPath, `${this.getRootPath()}/`))
  },
  isReviewLocation({ path = '', locale = '' } = {}) {
    return this.isReviewPath(path, locale)
  },
  isReviewPage(page) {
    if (!page) {
      return false
    }
    if (_.get(page, 'isReviewDraft', false) === true || _.get(page, 'isReviewDraft', 0) === 1) {
      return true
    }
    return this.isReviewPath(_.get(page, 'path', ''), _.get(page, 'localeCode', _.get(page, 'locale', '')))
  },
  isOwner(user, page) {
    return this.isAuthenticatedUser(user) && _.get(user, 'id', 0) === _.get(page, 'reviewOwnerId', 0)
  },
  isReviewer(user) {
    if (!this.isAuthenticatedUser(user)) {
      return false
    }
    return WIKI.auth.checkAccess(user, ['manage:system', 'manage:pages'], this.getRootPage())
  },
  canReadReviewPage(user, page) {
    if (!this.isReviewPage(page)) {
      return false
    }
    return this.isOwner(user, page) || this.isReviewer(user)
  },
  canEditReviewPage(user, page) {
    if (!this.isReviewPage(page)) {
      return false
    }
    return this.isOwner(user, page) || this.isReviewer(user)
  },
  canManageReviewPage(user, page) {
    return this.isReviewPage(page) && this.isReviewer(user)
  },
  applyReviewPermissions({ effectivePermissions, user, page }) {
    if (!this.isReviewPage(page)) {
      return effectivePermissions
    }

    const nextPermissions = _.cloneDeep(effectivePermissions)
    const canRead = this.canReadReviewPage(user, page)
    const canEdit = this.canEditReviewPage(user, page)
    const canManage = this.canManageReviewPage(user, page)

    nextPermissions.pages.read = canRead
    nextPermissions.pages.write = canEdit
    nextPermissions.pages.manage = canManage
    nextPermissions.pages.delete = canManage
    nextPermissions.pages.script = false
    nextPermissions.pages.style = false
    nextPermissions.source.read = canRead
    nextPermissions.history.read = canRead

    return nextPermissions
  }
}
