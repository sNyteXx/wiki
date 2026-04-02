/* global WIKI */

const Model = require('objection').Model
const moment = require('moment')
const path = require('path')
const fs = require('fs-extra')
const _ = require('lodash')
const assetHelper = require('../helpers/asset')
const { promisify } = require('util')
const CLIPBOARD_ROOT_FOLDER = 'clipboard_pictures'

/**
 * Users model
 */
module.exports = class Asset extends Model {
  static get tableName() { return 'assets' }

  static get jsonSchema () {
    return {
      type: 'object',

      properties: {
        id: {type: 'integer'},
        filename: {type: 'string'},
        hash: {type: 'string'},
        ext: {type: 'string'},
        kind: {type: 'string'},
        mime: {type: 'string'},
        fileSize: {type: 'integer'},
        metadata: {type: 'object'},
        createdAt: {type: 'string'},
        updatedAt: {type: 'string'}
      }
    }
  }

  static get relationMappings() {
    return {
      author: {
        relation: Model.BelongsToOneRelation,
        modelClass: require('./users'),
        join: {
          from: 'assets.authorId',
          to: 'users.id'
        }
      },
      folder: {
        relation: Model.BelongsToOneRelation,
        modelClass: require('./assetFolders'),
        join: {
          from: 'assets.folderId',
          to: 'assetFolders.id'
        }
      }
    }
  }

  async $beforeUpdate(opt, context) {
    await super.$beforeUpdate(opt, context)

    this.updatedAt = moment.utc().toISOString()
  }
  async $beforeInsert(context) {
    await super.$beforeInsert(context)

    this.createdAt = moment.utc().toISOString()
    this.updatedAt = moment.utc().toISOString()
  }

  async getAssetPath() {
    let hierarchy = []
    if (this.folderId) {
      hierarchy = await WIKI.models.assetFolders.getHierarchy(this.folderId)
    }
    return (this.folderId) ? hierarchy.map(h => h.slug).join('/') + `/${this.filename}` : this.filename
  }

  async deleteAssetCache() {
    await fs.remove(path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, `cache/${this.hash}.dat`))
  }

  static async upload(opts) {
    const fileInfo = path.parse(opts.originalname)
    const fileHash = assetHelper.generateHash(opts.assetPath)

    // Check for existing asset
    let asset = await WIKI.models.assets.query().where({
      hash: fileHash,
      folderId: opts.folderId
    }).first()

    // Build Object
    let assetRow = {
      filename: opts.originalname,
      hash: fileHash,
      ext: fileInfo.ext,
      kind: _.startsWith(opts.mimetype, 'image/') ? 'image' : 'binary',
      mime: opts.mimetype,
      fileSize: opts.size,
      folderId: opts.folderId
    }

    // Sanitize SVG contents
    if (
      WIKI.config.uploads.scanSVG &&
      (
        opts.mimetype.toLowerCase().startsWith('image/svg') ||
        fileInfo.ext.toLowerCase() === '.svg'
      )
    ) {
      const svgSanitizeJob = await WIKI.scheduler.registerJob({
        name: 'sanitize-svg',
        immediate: true,
        worker: true
      }, opts.path)
      await svgSanitizeJob.finished
    }

    // Save asset data
    try {
      const fileBuffer = await fs.readFile(opts.path)

      if (asset) {
        // Patch existing asset
        if (opts.mode === 'upload') {
          assetRow.authorId = opts.user.id
        }
        await WIKI.models.assets.query().patch(assetRow).findById(asset.id)
        await WIKI.models.knex('assetData').where({
          id: asset.id
        }).update({
          data: fileBuffer
        })
      } else {
        // Create asset entry
        assetRow.authorId = opts.user.id
        asset = await WIKI.models.assets.query().insert(assetRow)
        await WIKI.models.knex('assetData').insert({
          id: asset.id,
          data: fileBuffer
        })
      }

      // Move temp upload to cache
      if (opts.mode === 'upload') {
        await fs.move(opts.path, path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, `cache/${fileHash}.dat`), { overwrite: true })
      } else {
        await fs.copy(opts.path, path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, `cache/${fileHash}.dat`), { overwrite: true })
      }

      // Add to Storage
      if (!opts.skipStorage) {
        await WIKI.models.storage.assetEvent({
          event: 'uploaded',
          asset: {
            ...asset,
            path: await asset.getAssetPath(),
            data: fileBuffer,
            authorId: opts.user.id,
            authorName: opts.user.name,
            authorEmail: opts.user.email
          }
        })
      }
    } catch (err) {
      WIKI.logger.warn(err)
    }
  }

  static async getAsset(assetPath, res) {
    try {
      const fileInfo = assetHelper.getPathInfo(assetPath)
      const fileHash = assetHelper.generateHash(assetPath)
      const cachePath = path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, `cache/${fileHash}.dat`)

      // Force unsafe extensions to download
      if (WIKI.config.uploads.forceDownload && !['.png', '.apng', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(fileInfo.ext)) {
        res.set('Content-disposition', 'attachment; filename=' + encodeURIComponent(fileInfo.base))
      }

      if (await WIKI.models.assets.getAssetFromCache(assetPath, cachePath, res)) {
        return
      }
      if (await WIKI.models.assets.getAssetFromStorage(assetPath, res)) {
        return
      }
      await WIKI.models.assets.getAssetFromDb(assetPath, fileHash, cachePath, res)
    } catch (err) {
      if (err.code === `ECONNABORTED` || err.code === `EPIPE`) {
        return
      }
      WIKI.logger.error(err)
      res.sendStatus(500)
    }
  }

  static async getAssetFromCache(assetPath, cachePath, res) {
    try {
      await fs.access(cachePath, fs.constants.R_OK)
    } catch (err) {
      return false
    }
    const sendFile = promisify(res.sendFile.bind(res))
    res.type(path.extname(assetPath))
    await sendFile(cachePath, { dotfiles: 'deny' })
    return true
  }

  static async getAssetFromStorage(assetPath, res) {
    const localLocations = await WIKI.models.storage.getLocalLocations({
      asset: {
        path: assetPath
      }
    })
    for (let location of _.filter(localLocations, location => Boolean(location.path))) {
      const assetExists = await WIKI.models.assets.getAssetFromCache(assetPath, location.path, res)
      if (assetExists) {
        return true
      }
    }
    return false
  }

  static async getAssetFromDb(assetPath, fileHash, cachePath, res) {
    const asset = await WIKI.models.assets.query().where('hash', fileHash).first()
    if (asset) {
      const assetData = await WIKI.models.knex('assetData').where('id', asset.id).first()
      res.type(asset.ext)
      res.send(assetData.data)
      await fs.outputFile(cachePath, assetData.data)
    } else {
      res.sendStatus(404)
    }
  }

  static normalizeClipboardAssetPath(assetPath) {
    let normalizedPath = _.toString(assetPath).trim()
    if (!normalizedPath) {
      return ''
    }

    normalizedPath = normalizedPath.replace(/\\/g, '/')
    const rootPrefix = `${CLIPBOARD_ROOT_FOLDER}/`
    const rootIdx = normalizedPath.toLowerCase().indexOf(rootPrefix)
    if (rootIdx < 0) {
      return ''
    }

    normalizedPath = normalizedPath.substring(rootIdx)
    normalizedPath = normalizedPath.split('#')[0].split('?')[0]
    normalizedPath = normalizedPath.replace(/\/{2,}/g, '/')
    normalizedPath = normalizedPath.replace(/[),.;:!?]+$/, '')

    if (!_.startsWith(normalizedPath, rootPrefix)) {
      return ''
    }

    return normalizedPath
  }

  static extractClipboardAssetPaths(content) {
    const matches = _.toString(content).match(/clipboard_pictures\/[^\s<>"'`)\]]+/gi) || []
    const refs = new Set()
    for (const match of matches) {
      const normalizedPath = WIKI.models.assets.normalizeClipboardAssetPath(match)
      if (normalizedPath) {
        refs.add(normalizedPath)
      }
    }
    return refs
  }

  static async getClipboardAssetIndex() {
    const folderPaths = await WIKI.models.assetFolders.getAllPaths()
    const clipboardFolderIds = _.keys(folderPaths)
      .map(folderId => _.toInteger(folderId))
      .filter(folderId => {
        const folderPath = _.get(folderPaths, `${folderId}`, '')
        return folderId > 0 && (
          folderPath === CLIPBOARD_ROOT_FOLDER ||
          _.startsWith(folderPath, `${CLIPBOARD_ROOT_FOLDER}/`)
        )
      })

    if (clipboardFolderIds.length < 1) {
      return new Map()
    }

    const assets = await WIKI.models.assets.query()
      .select('id', 'filename', 'folderId')
      .whereIn('folderId', clipboardFolderIds)

    const assetIndex = new Map()
    for (const asset of assets) {
      const folderPath = _.get(folderPaths, `${asset.folderId}`, '')
      if (!folderPath) {
        continue
      }
      const assetPath = WIKI.models.assets.normalizeClipboardAssetPath(`${folderPath}/${asset.filename}`)
      if (!assetPath) {
        continue
      }
      assetIndex.set(assetPath, asset)
    }

    return assetIndex
  }

  static async getReferencedClipboardAssetPathsFromPages() {
    const pages = await WIKI.models.pages.query()
      .select('content')
      .where('content', 'like', `%${CLIPBOARD_ROOT_FOLDER}/%`)
    const refs = new Set()
    for (const page of pages) {
      for (const ref of WIKI.models.assets.extractClipboardAssetPaths(page.content)) {
        refs.add(ref)
      }
    }
    return refs
  }

  static async deleteAssetById(assetId, opts = {}) {
    const asset = await WIKI.models.assets.query().findById(assetId)
    if (!asset) {
      return false
    }

    const actor = opts.user || await WIKI.models.users.getRootUser()
    const assetPath = await asset.getAssetPath()

    await WIKI.models.knex('assetData').where('id', asset.id).del()
    await WIKI.models.assets.query().deleteById(asset.id)
    await asset.deleteAssetCache()

    if (!opts.skipStorage) {
      await WIKI.models.storage.assetEvent({
        event: 'deleted',
        asset: {
          ...asset,
          path: assetPath,
          authorId: _.get(actor, 'id', 1),
          authorName: _.get(actor, 'name', 'System'),
          authorEmail: _.get(actor, 'email', 'system@localhost')
        }
      })
    }

    return true
  }

  static async cleanupClipboardAssetsForPageChange(opts = {}) {
    const previousRefs = WIKI.models.assets.extractClipboardAssetPaths(opts.previousContent)
    if (previousRefs.size < 1) {
      return {
        deletedCount: 0,
        candidateCount: 0
      }
    }

    const nextRefs = WIKI.models.assets.extractClipboardAssetPaths(opts.nextContent)
    const removedPaths = _.difference(Array.from(previousRefs), Array.from(nextRefs))
    if (removedPaths.length < 1) {
      return {
        deletedCount: 0,
        candidateCount: 0
      }
    }

    const [assetIndex, referencedPaths] = await Promise.all([
      WIKI.models.assets.getClipboardAssetIndex(),
      WIKI.models.assets.getReferencedClipboardAssetPathsFromPages()
    ])
    if (assetIndex.size < 1) {
      return {
        deletedCount: 0,
        candidateCount: removedPaths.length
      }
    }

    const actor = opts.user || await WIKI.models.users.getRootUser()
    let deletedCount = 0

    for (const removedPath of removedPaths) {
      if (referencedPaths.has(removedPath)) {
        continue
      }

      const asset = assetIndex.get(removedPath)
      if (!asset) {
        continue
      }

      try {
        await WIKI.models.assets.deleteAssetById(asset.id, {
          user: actor
        })
        deletedCount++
      } catch (err) {
        WIKI.logger.warn(`Failed to delete unreferenced clipboard asset ${removedPath}: ${err.message}`)
      }
    }

    return {
      deletedCount,
      candidateCount: removedPaths.length
    }
  }

  static async cleanupClipboardAssetsGlobal(opts = {}) {
    const [assetIndex, referencedPaths] = await Promise.all([
      WIKI.models.assets.getClipboardAssetIndex(),
      WIKI.models.assets.getReferencedClipboardAssetPathsFromPages()
    ])

    if (assetIndex.size < 1) {
      return {
        checkedCount: 0,
        deletedCount: 0
      }
    }

    const actor = opts.user || await WIKI.models.users.getRootUser()
    let deletedCount = 0

    for (const [assetPath, asset] of assetIndex.entries()) {
      if (referencedPaths.has(assetPath)) {
        continue
      }
      try {
        await WIKI.models.assets.deleteAssetById(asset.id, {
          user: actor
        })
        deletedCount++
      } catch (err) {
        WIKI.logger.warn(`Failed to delete unreferenced clipboard asset ${assetPath}: ${err.message}`)
      }
    }

    return {
      checkedCount: assetIndex.size,
      deletedCount
    }
  }

  static async flushTempUploads() {
    return fs.emptyDir(path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, `uploads`))
  }
}
