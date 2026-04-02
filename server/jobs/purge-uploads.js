/* global WIKI */

const fs = require('fs-extra')
const moment = require('moment')
const path = require('path')

module.exports = async () => {
  WIKI.logger.info('Purging orphaned upload files...')

  try {
    const uplTempPath = path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'uploads')
    await fs.ensureDir(uplTempPath)
    const ls = await fs.readdir(uplTempPath)
    const fifteenAgo = moment().subtract(15, 'minutes')

    const files = await Promise.all(ls.map((f) => {
      return fs.stat(path.join(uplTempPath, f)).then((s) => { return { filename: f, stat: s } })
    }))
    const arrFiles = files.filter((s) => { return s.stat.isFile() })
    await Promise.all(arrFiles.map((f) => {
      if (moment(f.stat.ctime).isBefore(fifteenAgo, 'minute')) {
        return fs.unlink(path.join(uplTempPath, f.filename))
      }
    }))

    WIKI.logger.info('Purging orphaned upload files: [ COMPLETED ]')
  } catch (err) {
    WIKI.logger.error('Purging orphaned upload files: [ FAILED ]')
    WIKI.logger.error(err.message)
  }
}
