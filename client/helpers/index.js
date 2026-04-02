import { filesize } from 'filesize'
import _ from 'lodash'

/* global siteConfig */

const helpers = {
  filesize (rawSize) {
    return _.toUpper(filesize(rawSize))
  },
  makeSafePath (rawPath) {
    let rawParts = _.split(_.trim(rawPath), '/')
    rawParts = _.map(rawParts, (r) => {
      return _.kebabCase(_.deburr(_.trim(r)))
    })
    return _.join(_.filter(rawParts, (r) => { return !_.isEmpty(r) }), '/')
  },
  resolvePath (path) {
    if (_.startsWith(path, '/')) { path = path.substring(1) }
    return `${siteConfig.path}${path}`
  },
  setInputSelection (input, startPos, endPos) {
    input.focus()
    if (typeof input.selectionStart !== 'undefined') {
      input.selectionStart = startPos
      input.selectionEnd = endPos
    } else if (document.selection && document.selection.createRange) {
      input.select()
      var range = document.selection.createRange()
      range.collapse(true)
      range.moveEnd('character', endPos)
      range.moveStart('character', startPos)
      range.select()
    }
  }
}

export default {
  install(app) {
    app.config.globalProperties.$helpers = helpers
  }
}

export { helpers }
