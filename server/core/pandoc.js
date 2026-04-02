const _ = require('lodash')
const fs = require('fs-extra')
const path = require('path')
const mime = require('mime-types')
const sanitizeFilename = require('sanitize-filename')
const removeMarkdown = require('remove-markdown')
const tarFs = require('tar-fs')
const zlib = require('zlib')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { pipeline } = require('stream')
const { customAlphabet } = require('nanoid/non-secure')
const FileType = require('file-type')

/* global WIKI */

const execFileAsync = promisify(execFile)
const pipelineAsync = promisify(pipeline)
const nanoid = customAlphabet('1234567890abcdef', 12)

const STATUS_CACHE_MS = 60 * 1000
const MANAGED_PANDOC_VERSION = '3.9.0.2'
const MANAGED_PANDOC_DOWNLOAD_TIMEOUT_MS = 30 * 1000
const CLIPBOARD_ROOT_FOLDER = 'clipboard_pictures'
const SUPPORTED_OUTPUT_FORMATS = ['gfm', 'commonmark', 'commonmark_x', 'markdown']
const SUPPORTED_FALLBACK_READERS = ['markdown', 'commonmark_x', 'html', 'plain']
const SUPPORTED_ALLOWED_TYPES = ['docx', 'odt', 'html', 'md', 'txt', 'rtf', 'epub']
const GENERIC_MIME_TYPES = ['application/octet-stream', 'binary/octet-stream', 'text/plain']

const EXTENSION_TYPE_MAP = {
  docx: 'docx',
  odt: 'odt',
  html: 'html',
  htm: 'html',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
  text: 'txt',
  rtf: 'rtf',
  epub: 'epub',
  wiki: 'wiki'
}

const MIME_TYPE_MAP = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/plain': 'txt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/epub+zip': 'epub'
}

function escapeRegExp (value) {
  return _.toString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeLocale (value) {
  return _.trim(_.toString(value || '')).toLowerCase()
}

function normalizePagePath (value) {
  return _.trim(_.toString(value || ''), '/')
}

function safeFilename (value, fallback = 'file.bin') {
  const normalized = sanitizeFilename(_.toString(value || '').toLowerCase().replace(/[\s,;#]+/g, '_'))
  return normalized || fallback
}

module.exports = {
  status: {
    checkedAt: 0,
    isInstalled: false,
    version: '',
    configuredBinaryPath: 'pandoc',
    binaryPath: 'pandoc',
    statusMessage: 'Pandoc-Import ist deaktiviert.',
    lastError: ''
  },

  init () {
    this.managedInstallPromise = null
    this.status = {
      checkedAt: 0,
      isInstalled: false,
      version: '',
      configuredBinaryPath: this.getBinaryPath(),
      binaryPath: this.getBinaryPath(),
      statusMessage: 'Pandoc-Import ist deaktiviert.',
      lastError: ''
    }

    return this
  },

  getConfig () {
    const conf = _.get(WIKI.config, 'pandocImport', {})

    return {
      enabled: _.get(conf, 'enabled', true) !== false,
      defaultOutputFormat: this.getOutputFormat(_.get(conf, 'defaultOutputFormat', 'gfm')),
      enableWikiNormalizer: _.get(conf, 'enableWikiNormalizer', true) !== false,
      enableAutoTypeDetection: _.get(conf, 'enableAutoTypeDetection', true) !== false,
      fallbackReader: this.getFallbackReader(_.get(conf, 'fallbackReader', 'markdown')),
      allowedFileTypes: this.normalizeAllowedFileTypes(_.get(conf, 'allowedFileTypes', ['docx', 'odt', 'html', 'md', 'txt'])),
      maxFileSize: Math.max(1024, _.toSafeInteger(_.get(conf, 'maxFileSize', 10 * 1024 * 1024))),
      showWarnings: _.get(conf, 'showWarnings', true) !== false,
      pandocBinaryPath: this.getBinaryPath(_.get(conf, 'pandocBinaryPath', 'pandoc'))
    }
  },

  getBinaryPath (value = _.get(WIKI.config, 'pandocImport.pandocBinaryPath', 'pandoc')) {
    const binaryPath = _.trim(_.toString(value || 'pandoc'))
    return binaryPath || 'pandoc'
  },

  getManagedBinarySpec () {
    if (process.platform !== 'linux') {
      return null
    }

    let archiveArch = ''
    switch (process.arch) {
      case 'x64':
        archiveArch = 'amd64'
        break
      case 'arm64':
        archiveArch = 'arm64'
        break
      default:
        return null
    }

    return {
      version: MANAGED_PANDOC_VERSION,
      archiveDirName: `pandoc-${MANAGED_PANDOC_VERSION}`,
      archiveUrl: `https://github.com/jgm/pandoc/releases/download/${MANAGED_PANDOC_VERSION}/pandoc-${MANAGED_PANDOC_VERSION}-linux-${archiveArch}.tar.gz`
    }
  },

  getManagedInstallRoot () {
    return path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'bin', 'pandoc', MANAGED_PANDOC_VERSION)
  },

  getManagedBinaryPath () {
    return path.join(this.getManagedInstallRoot(), 'pandoc')
  },

  getProbeErrorMessage (err) {
    if (_.get(err, 'code') === 'ENOENT') {
      return 'Der Pandoc-Binary wurde nicht gefunden.'
    }
    if (_.get(err, 'code') === 'EACCES') {
      return 'Der Pandoc-Binary ist nicht ausfuehrbar.'
    }
    return _.toString(_.get(err, 'message', 'Pandoc konnte nicht ausgefuehrt werden.'))
  },

  async probeBinary (binaryPath) {
    try {
      const result = await execFileAsync(binaryPath, ['--version'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      })
      const firstLine = _.first(_.toString(result.stdout || '').split(/\r?\n/)) || ''
      const versionMatch = firstLine.match(/pandoc\s+([0-9][\w.\-]+)/i)

      return {
        isInstalled: true,
        version: _.get(versionMatch, '[1]', ''),
        binaryPath
      }
    } catch (err) {
      return {
        isInstalled: false,
        version: '',
        binaryPath,
        errorMessage: this.getProbeErrorMessage(err)
      }
    }
  },

  async downloadManagedArchive (archiveUrl, archivePath) {
    await fs.ensureDir(path.dirname(archivePath))

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), MANAGED_PANDOC_DOWNLOAD_TIMEOUT_MS)

    let resp
    try {
      resp = await fetch(archiveUrl, {
        headers: {
          'User-Agent': `wikijs-pandoc/${MANAGED_PANDOC_VERSION}`
        },
        redirect: 'follow',
        signal: abortController.signal
      })
    } catch (err) {
      clearTimeout(timeoutId)
      throw new Error(`Der projektlokale Pandoc-Download ist fehlgeschlagen. ${_.toString(err.message || err)}`)
    }
    clearTimeout(timeoutId)

    if (!resp.ok) {
      throw new Error(`Der projektlokale Pandoc-Download ist mit HTTP ${resp.status} fehlgeschlagen.`)
    }

    const { Readable } = require('stream')
    const readable = Readable.fromWeb(resp.body)

    return new Promise((resolve, reject) => {
      let settled = false
      const output = fs.createWriteStream(archivePath)

      const finalize = (err) => {
        if (settled) {
          return
        }
        settled = true
        if (err) {
          output.destroy()
          reject(err)
        } else {
          resolve()
        }
      }

      readable.on('error', err => finalize(new Error(`Der projektlokale Pandoc-Download ist fehlgeschlagen. ${_.toString(err.message || err)}`)))
      output.on('error', err => finalize(new Error(`Das Pandoc-Archiv konnte nicht gespeichert werden. ${_.toString(err.message || err)}`)))
      output.on('finish', () => finalize())

      readable.pipe(output)
    })
  },

  async ensureManagedBinary () {
    const managedBinaryPath = this.getManagedBinaryPath()
    if ((await this.probeBinary(managedBinaryPath)).isInstalled) {
      return managedBinaryPath
    }

    if (this.managedInstallPromise) {
      return this.managedInstallPromise
    }

    const spec = this.getManagedBinarySpec()
    if (!spec) {
      throw new Error(`Diese Plattform wird fuer den projektlokalen Pandoc-Binary nicht unterstuetzt (${process.platform}/${process.arch}).`)
    }

    this.managedInstallPromise = (async () => {
      const installRoot = this.getManagedInstallRoot()
      const tempRoot = path.join(installRoot, '_tmp')
      const archivePath = path.join(tempRoot, 'pandoc.tar.gz')
      const extractRoot = path.join(tempRoot, 'extract')
      const extractedBinaryPath = path.join(extractRoot, spec.archiveDirName, 'bin', 'pandoc')

      await fs.remove(tempRoot).catch(() => {})
      await fs.ensureDir(tempRoot)

      try {
        WIKI.logger.info(`[pandoc-import] Downloading managed Pandoc ${spec.version}...`)
        await this.downloadManagedArchive(spec.archiveUrl, archivePath)
        await fs.ensureDir(extractRoot)
        await pipelineAsync(
          fs.createReadStream(archivePath),
          zlib.createGunzip(),
          tarFs.extract(extractRoot)
        )

        if (!(await this.probeBinary(extractedBinaryPath)).isInstalled) {
          throw new Error('Das heruntergeladene Pandoc-Archiv enthaelt keinen verwendbaren Binary.')
        }

        await fs.ensureDir(path.dirname(managedBinaryPath))
        await fs.copy(extractedBinaryPath, managedBinaryPath, { overwrite: true })
        await fs.chmod(managedBinaryPath, 0o755)

        WIKI.logger.info(`[pandoc-import] Managed Pandoc installed at ${managedBinaryPath}`)
        return managedBinaryPath
      } catch (err) {
        throw new Error(`Der projektlokale Pandoc-Binary konnte nicht eingerichtet werden. ${_.toString(err.message || err)}`)
      } finally {
        await fs.remove(tempRoot).catch(() => {})
      }
    })().finally(() => {
      this.managedInstallPromise = null
    })

    return this.managedInstallPromise
  },

  async resolveBinaryStatus (configuredBinaryPath) {
    const configuredPath = this.getBinaryPath(configuredBinaryPath)
    const managedBinaryPath = this.getManagedBinaryPath()
    let lastError = ''

    for (const candidatePath of _.uniq([configuredPath, managedBinaryPath])) {
      const probe = await this.probeBinary(candidatePath)
      if (probe.isInstalled) {
        return probe
      }
      lastError = probe.errorMessage || lastError
    }

    try {
      const installedPath = await this.ensureManagedBinary()
      const probe = await this.probeBinary(installedPath)
      if (probe.isInstalled) {
        return probe
      }
      lastError = probe.errorMessage || lastError
    } catch (err) {
      lastError = _.toString(_.get(err, 'message', 'Der projektlokale Pandoc-Binary konnte nicht eingerichtet werden.'))
    }

    return {
      isInstalled: false,
      version: '',
      binaryPath: configuredPath,
      errorMessage: lastError || 'Pandoc konnte nicht gefunden oder gestartet werden.'
    }
  },

  getOutputFormat (value) {
    const outputFormat = _.toString(value || '').toLowerCase()
    return SUPPORTED_OUTPUT_FORMATS.includes(outputFormat) ? outputFormat : 'gfm'
  },

  getFallbackReader (value) {
    const fallbackReader = _.toString(value || '').toLowerCase()
    return SUPPORTED_FALLBACK_READERS.includes(fallbackReader) ? fallbackReader : 'markdown'
  },

  normalizeAllowedFileTypes (values) {
    const rawValues = _.isArray(values) ? values : [values]
    const normalized = rawValues
      .map(value => _.toString(value || '').toLowerCase())
      .map(value => {
        switch (value) {
          case 'htm':
            return 'html'
          case 'markdown':
            return 'md'
          case 'text':
          case 'plain':
            return 'txt'
          default:
            return value
        }
      })
      .filter(value => SUPPORTED_ALLOWED_TYPES.includes(value))

    return _.uniq(normalized.length > 0 ? normalized : ['docx', 'odt', 'html', 'md', 'txt'])
  },

  getPipelineLabel (writer, enableWikiNormalizer) {
    return enableWikiNormalizer
      ? `Pandoc -> ${writer} -> Wiki-Normalizer`
      : `Pandoc -> ${writer}`
  },

  getAllowlistTypeForReader (reader) {
    switch (reader) {
      case 'html':
        return 'html'
      case 'plain':
        return 'txt'
      case 'commonmark_x':
      case 'markdown':
      default:
        return 'md'
    }
  },

  getMarkdownInputReader () {
    const conf = this.getConfig()
    return conf.fallbackReader === 'commonmark_x' ? 'commonmark_x' : 'markdown'
  },

  mapExtensionToType (extension) {
    return _.get(EXTENSION_TYPE_MAP, _.toString(extension || '').toLowerCase(), '')
  },

  mapMimeToType (mimetype) {
    return _.get(MIME_TYPE_MAP, _.toString(mimetype || '').toLowerCase(), '')
  },

  canonicalTypeToReader (canonicalType) {
    switch (canonicalType) {
      case 'md':
        return this.getMarkdownInputReader()
      case 'txt':
        return this.getFallbackReader(this.getConfig().fallbackReader) === 'plain' ? 'plain' : this.getMarkdownInputReader()
      case 'docx':
      case 'odt':
      case 'html':
      case 'rtf':
      case 'epub':
        return canonicalType
      default:
        return this.getConfig().fallbackReader
    }
  },

  async refreshStatus ({ force = false } = {}) {
    const conf = this.getConfig()
    const now = Date.now()

    if (!force && this.status.checkedAt > 0 && now - this.status.checkedAt < STATUS_CACHE_MS && this.status.configuredBinaryPath === conf.pandocBinaryPath) {
      return this.getStatusSnapshot()
    }

    const resolvedStatus = await this.resolveBinaryStatus(conf.pandocBinaryPath)
    const isInstalled = resolvedStatus.isInstalled === true
    const version = _.toString(resolvedStatus.version || '')
    const lastError = _.toString(resolvedStatus.errorMessage || '')

    this.status = {
      checkedAt: now,
      isInstalled,
      version,
      configuredBinaryPath: conf.pandocBinaryPath,
      binaryPath: resolvedStatus.binaryPath || conf.pandocBinaryPath,
      statusMessage: this.getStatusMessage({
        enabled: conf.enabled,
        isInstalled,
        version,
        lastError
      }),
      lastError
    }

    return this.getStatusSnapshot()
  },

  getStatusMessage ({ enabled, isInstalled, version, lastError }) {
    if (!enabled) {
      return 'Pandoc-Import ist deaktiviert.'
    }

    if (!isInstalled) {
      return lastError
        ? `Pandoc wurde nicht gefunden oder konnte nicht gestartet werden. ${lastError}`
        : 'Pandoc wurde nicht gefunden oder konnte nicht gestartet werden.'
    }

    if (version) {
      return `Pandoc ist verfügbar (${version}).`
    }

    return 'Pandoc ist verfügbar.'
  },

  getStatusSnapshot () {
    const conf = this.getConfig()

    return {
      isAvailable: conf.enabled && this.status.isInstalled,
      isInstalled: this.status.isInstalled,
      version: this.status.version,
      binaryPath: this.status.binaryPath,
      statusMessage: this.status.statusMessage
    }
  },

  isAllowedType (canonicalType) {
    return this.getConfig().allowedFileTypes.includes(canonicalType)
  },

  async detectReader ({ originalname, mimetype, filePath }) {
    const conf = this.getConfig()
    const warnings = []

    const extension = _.trimStart(path.extname(_.toString(originalname || '')).toLowerCase(), '.')
    const extensionType = this.mapExtensionToType(extension)
    const browserMimeType = _.toString(mimetype || '').split(';')[0].trim().toLowerCase()

    let sniffedMimeType = ''
    if (filePath) {
      try {
        const detectedFileType = await FileType.fromFile(filePath)
        sniffedMimeType = _.toString(_.get(detectedFileType, 'mime', '')).toLowerCase()
      } catch (err) {}
    }

    const browserMimeIsGeneric = GENERIC_MIME_TYPES.includes(browserMimeType)
    const mimeTypeRaw = this.mapMimeToType(browserMimeType)
    const mimeType = (browserMimeIsGeneric && extensionType && extensionType !== 'txt') ? '' : mimeTypeRaw
    const sniffedType = this.mapMimeToType(sniffedMimeType)
    const mimeSignal = mimeType || sniffedType
    const uniqueSignals = _.uniq([extensionType, mimeSignal].filter(Boolean))

    if (extensionType === 'wiki') {
      warnings.push({
        code: 'unknown',
        message: 'Die Dateiendung .wiki ist nicht eindeutig. Es wird der konfigurierte Fallback-Reader verwendet.'
      })
      const fallbackCanonicalType = this.getAllowlistTypeForReader(conf.fallbackReader)
      return {
        extension,
        browserMimeType,
        sniffedMimeType,
        detectedType: 'unknown',
        canonicalType: fallbackCanonicalType,
        selectedReader: conf.fallbackReader,
        warnings
      }
    }

    if (!conf.enableAutoTypeDetection) {
      const fallbackCanonicalType = this.getAllowlistTypeForReader(conf.fallbackReader)
      return {
        extension,
        browserMimeType,
        sniffedMimeType,
        detectedType: fallbackCanonicalType,
        canonicalType: fallbackCanonicalType,
        selectedReader: conf.fallbackReader,
        warnings
      }
    }

    if (extensionType && mimeSignal && extensionType !== mimeSignal) {
      warnings.push({
        code: 'conflict',
        message: 'Dateiendung und MIME-Type widersprechen sich. Es wird der konfigurierte Fallback-Reader verwendet.'
      })
      const fallbackCanonicalType = this.getAllowlistTypeForReader(conf.fallbackReader)
      return {
        extension,
        browserMimeType,
        sniffedMimeType,
        detectedType: extensionType,
        canonicalType: fallbackCanonicalType,
        selectedReader: conf.fallbackReader,
        warnings
      }
    }

    if (uniqueSignals.length === 1) {
      const canonicalType = uniqueSignals[0]
      if (!(extensionType && mimeSignal && extensionType === mimeSignal)) {
        warnings.push({
          code: 'low-confidence',
          message: 'Der Eingabetyp konnte nur aus einer Quelle sicher erkannt werden. Bitte prüfe das Ergebnis nach dem Import.'
        })
      }
      return {
        extension,
        browserMimeType,
        sniffedMimeType,
        detectedType: canonicalType,
        canonicalType,
        selectedReader: this.canonicalTypeToReader(canonicalType),
        warnings
      }
    }

    warnings.push({
      code: 'unknown',
      message: 'Der Eingabetyp konnte nicht sicher erkannt werden. Es wird der konfigurierte Fallback-Reader verwendet.'
    })
    const fallbackCanonicalType = this.getAllowlistTypeForReader(conf.fallbackReader)
    return {
      extension,
      browserMimeType,
      sniffedMimeType,
      detectedType: 'unknown',
      canonicalType: fallbackCanonicalType,
      selectedReader: conf.fallbackReader,
      warnings
    }
  },

  async convertImport ({ filePath, originalname, mimetype, user, locale, pagePath, reviewWorkflow = false }) {
    const conf = this.getConfig()
    const normalizedLocale = normalizeLocale(locale)
    const normalizedPath = normalizePagePath(pagePath)

    if (!conf.enabled) {
      const err = new Error('Der Dokumentimport über Pandoc ist derzeit deaktiviert.')
      err.status = 503
      throw err
    }

    if (!normalizedLocale || !normalizedPath) {
      const err = new Error('Locale und Zielpfad sind für den Dokumentimport erforderlich.')
      err.status = 400
      throw err
    }

    if (!WIKI.auth.checkAccess(user, ['write:pages'], { locale: normalizedLocale, path: normalizedPath })) {
      const err = new Error('Du darfst auf diesem Pfad keine Seiten anlegen oder bearbeiten.')
      err.status = 403
      throw err
    }

    const status = await this.refreshStatus({ force: true })
    if (!status.isInstalled) {
      const err = new Error(status.statusMessage)
      err.status = 503
      throw err
    }

    const pandocBinaryPath = status.binaryPath || conf.pandocBinaryPath

    const detection = await this.detectReader({ originalname, mimetype, filePath })
    if (!this.isAllowedType(detection.canonicalType)) {
      const err = new Error(`Dateityp "${detection.detectedType || detection.canonicalType}" ist für den Pandoc-Import nicht freigegeben.`)
      err.status = 415
      throw err
    }

    const requestId = nanoid()
    const tempRoot = path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'uploads', 'pandoc-import', requestId)
    const extractMediaRoot = path.join(tempRoot, 'extracted')
    const writer = conf.defaultOutputFormat
    const pandocArgs = [
      filePath,
      '-f', detection.selectedReader,
      '-t', writer,
      '--wrap=none',
      '--markdown-headings=atx',
      `--extract-media=${extractMediaRoot}`
    ]

    let stdout = ''
    let stderr = ''
    const warnings = _.cloneDeep(detection.warnings)
    const startTime = Date.now()

    await fs.ensureDir(tempRoot)

    try {
      const result = await execFileAsync(pandocBinaryPath, pandocArgs, {
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024
      })
      stdout = _.toString(result.stdout || '')
      stderr = _.toString(result.stderr || '')

      if (_.trim(stderr)) {
        stderr.split(/\r?\n/).map(line => _.trim(line)).filter(Boolean).forEach(line => {
          warnings.push({
            code: 'pandoc-warning',
            message: line
          })
        })
      }

      const mediaResult = await this.importExtractedMedia({
        content: stdout,
        extractMediaRoot,
        requestId,
        user
      })

      warnings.push(...mediaResult.warnings)

      const normalizedResult = conf.enableWikiNormalizer
        ? this.normalizeMarkdown(mediaResult.content)
        : {
            content: _.toString(mediaResult.content || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
            warnings: [],
            suggestedDescription: this.extractSuggestedDescription(mediaResult.content)
          }

      warnings.push(...normalizedResult.warnings)

      const finalWarnings = conf.showWarnings ? warnings : []
      const suggestedTitle = _.trim(_.toString(originalname || '').replace(/\.[^.]+$/, '')) || 'Importiertes Dokument'

      WIKI.logger.info(`[pandoc-import:${requestId}] Conversion completed in ${Date.now() - startTime}ms reader=${detection.selectedReader} writer=${writer} type=${detection.canonicalType}`)

      return {
        succeeded: true,
        sourceFilename: _.toString(originalname || ''),
        detectedType: detection.detectedType,
        detectedMime: detection.sniffedMimeType || detection.browserMimeType || '',
        selectedReader: detection.selectedReader,
        selectedWriter: writer,
        pipeline: this.getPipelineLabel(writer, conf.enableWikiNormalizer),
        suggestedTitle,
        suggestedDescription: normalizedResult.suggestedDescription,
        warnings: finalWarnings,
        content: normalizedResult.content
      }
    } catch (err) {
      WIKI.logger.warn(`[pandoc-import:${requestId}] Conversion failed after ${Date.now() - startTime}ms reader=${detection.selectedReader} writer=${writer} mime=${mimetype || 'n/a'}: ${err.message}`)
      const isMissingBinary = _.get(err, 'code') === 'ENOENT'
      const friendlyError = new Error(isMissingBinary
        ? 'Pandoc konnte auf dem Server nicht gestartet werden. Bitte prüfe die Installation oder den konfigurierten Binary-Pfad.'
        : 'Die Datei konnte nicht nach Markdown konvertiert werden. Bitte prüfe Dateityp, Inhalt und Pandoc-Konfiguration.')
      friendlyError.status = err.killed ? 504 : (isMissingBinary ? 503 : 422)
      throw friendlyError
    } finally {
      await fs.remove(tempRoot)
        .catch(cleanupErr => {
          WIKI.logger.warn(`[pandoc-import:${requestId}] Failed to cleanup temp files: ${cleanupErr.message}`)
        })
    }
  },

  async importExtractedMedia ({ content, extractMediaRoot, requestId, user }) {
    const warnings = []
    let nextContent = _.toString(content || '')

    if (!(await fs.pathExists(extractMediaRoot))) {
      return {
        content: nextContent,
        warnings
      }
    }

    const extractedFiles = await this.listFilesRecursive(extractMediaRoot)
    if (extractedFiles.length < 1) {
      return {
        content: nextContent,
        warnings
      }
    }

    const folderSuffix = safeFilename(`import_${user.id}_${Date.now()}_${requestId.slice(0, 6)}`, `import_${requestId.slice(0, 6)}`)
    const pathReplacements = new Map()
    const skippedMediaRefs = []

    for (const file of extractedFiles) {
      const relPath = file.relativePath
      const relPathNormalized = relPath.split(path.sep).join('/')
      const relSegments = relPathNormalized.split('/').filter(Boolean)
      const rawFilename = _.last(relSegments) || 'asset.bin'
      const safeName = safeFilename(rawFilename, 'asset.bin')
      const folderSegments = relSegments.slice(0, -1).map(segment => safeFilename(segment, 'folder')).filter(Boolean)
      const assetSegments = [CLIPBOARD_ROOT_FOLDER, folderSuffix, ...folderSegments]
      const assetFolderPath = assetSegments.join('/')
      const assetPath = `${assetFolderPath}/${safeName}`

      if (!WIKI.auth.checkAccess(user, ['write:assets'], { path: assetPath })) {
        skippedMediaRefs.push({
          relPath: relPathNormalized,
          filename: safeName
        })
        continue
      }

      const folderId = await this.ensureAssetFolderPath(assetSegments)
      const stat = await fs.stat(file.fullPath)
      const mimetype = _.toString(mime.lookup(file.fullPath) || 'application/octet-stream')

      await WIKI.models.assets.upload({
        originalname: safeName,
        mimetype,
        size: stat.size,
        path: file.fullPath,
        mode: 'copy',
        folderId,
        assetPath,
        user
      })

      pathReplacements.set(relPathNormalized, `/${assetPath}`)
    }

    nextContent = this.applyMediaReplacements(nextContent, pathReplacements, skippedMediaRefs)

    if (skippedMediaRefs.length > 0) {
      warnings.push({
        code: 'images-skipped-no-asset-permission',
        message: `${skippedMediaRefs.length} eingebettete Medien konnten nicht übernommen werden, weil die Asset-Berechtigung für den internen Importpfad fehlt.`
      })
    }

    return {
      content: nextContent,
      warnings
    }
  },

  applyMediaReplacements (content, replacements, skippedMediaRefs) {
    let nextContent = _.toString(content || '')

    for (const [sourcePath, targetPath] of replacements.entries()) {
      nextContent = nextContent.replace(new RegExp(escapeRegExp(sourcePath), 'g'), targetPath)
    }

    skippedMediaRefs.forEach(item => {
      const escapedPath = escapeRegExp(item.relPath)
      const imageSyntaxRegex = new RegExp(`!\\[([^\\]]*)\\]\\((?:<)?${escapedPath}(?:>)?(?:\\s+"[^"]*")?\\)`, 'g')
      nextContent = nextContent.replace(imageSyntaxRegex, (match, label) => {
        const displayLabel = _.trim(label) || item.filename
        return `*Bild ausgelassen: ${displayLabel}*`
      })
    })

    return nextContent
  },

  sanitizeFolderSegment (value) {
    return safeFilename(value, '').replace(/\./g, '_')
  },

  async ensureAssetFolderPath (segments) {
    let parentId = null

    for (const segment of segments) {
      const slug = this.sanitizeFolderSegment(segment)
      if (!slug) {
        continue
      }
      parentId = await this.ensureAssetFolder(parentId, slug)
    }

    return parentId
  },

  async ensureAssetFolder (parentId, slug) {
    const existing = await WIKI.models.assetFolders.query().where({
      parentId,
      slug
    }).first()

    if (existing) {
      return existing.id
    }

    try {
      const inserted = await WIKI.models.assetFolders.query().insert({
        parentId,
        slug,
        name: slug
      })
      return inserted.id
    } catch (err) {
      const fallback = await WIKI.models.assetFolders.query().where({
        parentId,
        slug
      }).first()
      if (fallback) {
        return fallback.id
      }
      throw err
    }
  },

  async listFilesRecursive (rootDir, prefix = '') {
    const entries = await fs.readdir(rootDir, { withFileTypes: true })
    let files = []

    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        files = files.concat(await this.listFilesRecursive(fullPath, relPath))
      } else {
        files.push({
          relativePath: relPath,
          fullPath
        })
      }
    }

    return files
  },

  normalizeMarkdown (content) {
    const warnings = []
    let nextContent = _.toString(content || '').replace(/\r\n?/g, '\n')

    const commentMatches = nextContent.match(/<!--[\s\S]*?-->/g) || []
    if (commentMatches.length > 0) {
      nextContent = nextContent.replace(/<!--[\s\S]*?-->/g, '')
      warnings.push({
        code: 'html-comments-removed',
        message: `${commentMatches.length} HTML-Kommentar(e) wurden aus dem Import entfernt.`
      })
    }

    const dangerousTagPatterns = [
      { tag: 'script', pattern: /<script\b[\s\S]*?<\/script>/gi },
      { tag: 'style', pattern: /<style\b[\s\S]*?<\/style>/gi },
      { tag: 'iframe', pattern: /<iframe\b[\s\S]*?<\/iframe>/gi },
      { tag: 'object', pattern: /<object\b[\s\S]*?<\/object>/gi },
      { tag: 'embed', pattern: /<embed\b[^>]*>/gi }
    ]

    let removedDangerousBlocks = 0
    dangerousTagPatterns.forEach(item => {
      const matches = nextContent.match(item.pattern) || []
      if (matches.length > 0) {
        removedDangerousBlocks += matches.length
        nextContent = nextContent.replace(item.pattern, '')
      }
    })

    if (removedDangerousBlocks > 0) {
      warnings.push({
        code: 'raw-html-removed',
        message: `${removedDangerousBlocks} unsichere HTML-Block(e) wurden entfernt.`
      })
    }

    let escapedRawHtmlBlocks = 0
    let inFence = false
    let fenceMarker = ''

    const processedLines = nextContent.split('\n').map(line => {
      const trimmed = line.trim()
      const fenceMatch = trimmed.match(/^(```+|~~~+)/)
      if (fenceMatch) {
        const nextFenceMarker = fenceMatch[1].charAt(0)
        if (!inFence) {
          inFence = true
          fenceMarker = nextFenceMarker
        } else if (nextFenceMarker === fenceMarker) {
          inFence = false
          fenceMarker = ''
        }
        return line
      }

      if (inFence || !trimmed.startsWith('<') || !trimmed.includes('>')) {
        return line
      }

      if (/^<(https?:\/\/|mailto:)/i.test(trimmed)) {
        return line
      }

      if (/^<\/?[a-z][\w:-]*(\s[^>]*)?>$/i.test(trimmed)) {
        escapedRawHtmlBlocks++
        return _.escape(line)
      }

      return line
    })

    nextContent = processedLines.join('\n')
    nextContent = nextContent.replace(/[ \t]+\n/g, '\n')
    nextContent = nextContent.replace(/\n{3,}/g, '\n\n')
    nextContent = nextContent.trim()

    if (escapedRawHtmlBlocks > 0) {
      warnings.push({
        code: 'raw-html-escaped',
        message: `${escapedRawHtmlBlocks} rohe HTML-Zeile(n) wurden als Text maskiert.`
      })
    }

    return {
      content: nextContent,
      warnings,
      suggestedDescription: this.extractSuggestedDescription(nextContent)
    }
  },

  extractSuggestedDescription (content) {
    const blocks = _.toString(content || '').split(/\n{2,}/)
    for (const block of blocks) {
      const trimmed = _.trim(block)
      if (!trimmed) {
        continue
      }
      if (/^(```|~~~)/.test(trimmed) || /^#{1,6}\s/.test(trimmed)) {
        continue
      }
      const plainText = _.trim(removeMarkdown(trimmed, { useImgAltText: true }).replace(/\s+/g, ' '))
      if (plainText.length > 0) {
        return plainText.slice(0, 255)
      }
    }

    return ''
  }
}