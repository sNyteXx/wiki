const path = require('path')
const { v4: uuid } = require('uuid')
const bodyParser = require('body-parser')
const compression = require('compression')
const express = require('express')
const favicon = require('serve-favicon')
const http = require('http')
const fs = require('fs-extra')
const _ = require('lodash')
const crypto = require('crypto')
const pem2jwk = require('pem-jwk').pem2jwk
const semver = require('semver')

const randomBytesAsync = require('util').promisify(crypto.randomBytes)

/* global WIKI */

module.exports = () => {
  WIKI.config.site = {
    path: '',
    title: 'Wiki.js'
  }

  WIKI.system = require('./core/system')

  // ----------------------------------------
  // Define Express App
  // ----------------------------------------

  let app = express()
  app.use(compression())

  // ----------------------------------------
  // Public Assets
  // ----------------------------------------

  const faviconPath = path.join(WIKI.ROOTPATH, 'assets', 'favicon.ico')
  if (fs.existsSync(faviconPath)) {
    app.use(favicon(faviconPath))
  }
  app.use('/_assets', express.static(path.join(WIKI.ROOTPATH, 'assets')))

  // ----------------------------------------
  // View Engine Setup
  // ----------------------------------------

  app.set('views', path.join(WIKI.SERVERPATH, 'views'))
  app.set('view engine', 'pug')

  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: false }))

  app.locals.config = WIKI.config
  app.locals.data = WIKI.data
  app.locals._ = require('lodash')
  app.locals.devMode = WIKI.devMode

  // ----------------------------------------
  // HMR (Dev Mode Only)
  // ----------------------------------------

  if (global.DEV) {
    app.use(global.WP_DEV.devMiddleware)
    app.use(global.WP_DEV.hotMiddleware)
  }

  // ----------------------------------------
  // Controllers
  // ----------------------------------------

  app.get('*', async (req, res) => {
    let packageObj = await fs.readJson(path.join(WIKI.ROOTPATH, 'package.json'))
    res.render('setup', { packageObj })
  })

  /**
   * Finalize
   */
  app.post('/finalize', async (req, res) => {
    try {
      // Set config
      _.set(WIKI.config, 'auth', {
        audience: 'urn:wiki.js',
        tokenExpiration: '30m',
        tokenRenewal: '14d'
      })
      _.set(WIKI.config, 'company', '')
      _.set(WIKI.config, 'features', {
        featurePageRatings: true,
        featurePageComments: true,
        featurePersonalWikis: true
      })
      _.set(WIKI.config, 'graphEndpoint', 'https://graph.requarks.io')
      _.set(WIKI.config, 'host', req.body.siteUrl)
      _.set(WIKI.config, 'lang', {
        code: 'en',
        autoUpdate: true,
        namespacing: false,
        namespaces: []
      })
      _.set(WIKI.config, 'logo', {
        hasLogo: false,
        logoIsSquare: false
      })
      _.set(WIKI.config, 'mail', {
        senderName: '',
        senderEmail: '',
        host: '',
        port: 465,
        name: '',
        secure: true,
        verifySSL: true,
        user: '',
        pass: '',
        useDKIM: false,
        dkimDomainName: '',
        dkimKeySelector: '',
        dkimPrivateKey: ''
      })
      _.set(WIKI.config, 'seo', {
        description: '',
        robots: ['index', 'follow'],
        analyticsService: '',
        analyticsId: ''
      })
      _.set(WIKI.config, 'sessionSecret', (await randomBytesAsync(32)).toString('hex'))
      _.set(WIKI.config, 'telemetry', {
        isEnabled: req.body.telemetry === true,
        clientId: uuid()
      })
      _.set(WIKI.config, 'theming', {
        theme: 'default',
        darkMode: false,
        iconset: 'mdi',
        injectCSS: '',
        injectHead: '',
        injectBody: ''
      })
      _.set(WIKI.config, 'title', 'Wiki.js')

      // Init Telemetry
      WIKI.kernel.initTelemetry()
      // WIKI.telemetry.sendEvent('setup', 'install-start')

      // Basic checks
      if (!semver.satisfies(process.version, '>=10.12')) {
        throw new Error('Node.js 10.12.x or later required!')
      }

      // Create directory structure
      WIKI.logger.info('Creating data directories...')
      await fs.ensureDir(path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath))
      await fs.emptyDir(path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'cache'))
      await fs.ensureDir(path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'uploads'))

      // Generate certificates
      WIKI.logger.info('Generating certificates...')
      const certs = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'pkcs1',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs1',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: WIKI.config.sessionSecret
        }
      })

      _.set(WIKI.config, 'certs', {
        jwk: pem2jwk(certs.publicKey),
        public: certs.publicKey,
        private: certs.privateKey
      })

      // Save config to DB
      WIKI.logger.info('Persisting config to DB...')
      await WIKI.configSvc.saveToDb([
        'auth',
        'certs',
        'company',
        'features',
        'graphEndpoint',
        'host',
        'lang',
        'logo',
        'mail',
        'seo',
        'sessionSecret',
        'telemetry',
        'theming',
        'uploads',
        'title'
      ], false)

      // Truncate tables (reset from previous failed install)
      await WIKI.models.locales.query().where('code', '!=', 'x').del()
      await WIKI.models.navigation.query().truncate()
      switch (WIKI.config.db.type) {
        case 'postgres':
          await WIKI.models.knex.raw('TRUNCATE groups, users CASCADE')
          break
        case 'mysql':
        case 'mariadb':
          await WIKI.models.groups.query().where('id', '>', 0).del()
          await WIKI.models.users.query().where('id', '>', 0).del()
          await WIKI.models.knex.raw('ALTER TABLE `groups` AUTO_INCREMENT = 1')
          await WIKI.models.knex.raw('ALTER TABLE `users` AUTO_INCREMENT = 1')
          break
        case 'mssql':
          await WIKI.models.groups.query().del()
          await WIKI.models.users.query().del()
          await WIKI.models.knex.raw(`
            IF EXISTS (SELECT * FROM sys.identity_columns WHERE OBJECT_NAME(OBJECT_ID) = 'groups' AND last_value IS NOT NULL)
              DBCC CHECKIDENT ([groups], RESEED, 0)
          `)
          await WIKI.models.knex.raw(`
            IF EXISTS (SELECT * FROM sys.identity_columns WHERE OBJECT_NAME(OBJECT_ID) = 'users' AND last_value IS NOT NULL)
              DBCC CHECKIDENT ([users], RESEED, 0)
          `)
          break
        case 'sqlite':
          await WIKI.models.groups.query().truncate()
          await WIKI.models.users.query().truncate()
          break
      }

      // Create default locale
      WIKI.logger.info('Installing default locale...')
      await WIKI.models.locales.query().insert({
        code: 'en',
        strings: {},
        isRTL: false,
        name: 'English',
        nativeName: 'English'
      })

      // Create default groups

      WIKI.logger.info('Creating default groups...')
      const adminGroup = await WIKI.models.groups.query().insert({
        name: 'Administrators',
        permissions: JSON.stringify(['manage:system']),
        pageRules: JSON.stringify([]),
        isSystem: true
      })
      const guestGroup = await WIKI.models.groups.query().insert({
        name: 'Guests',
        permissions: JSON.stringify(['read:pages', 'read:assets', 'read:comments']),
        pageRules: JSON.stringify([
          { id: 'guest', roles: ['read:pages', 'read:assets', 'read:comments'], match: 'START', deny: false, path: '', locales: [] }
        ]),
        isSystem: true
      })
      if (adminGroup.id !== 1 || guestGroup.id !== 2) {
        throw new Error('Incorrect groups auto-increment configuration! Should start at 0 and increment by 1. Contact your database administrator.')
      }

      await WIKI.models.users.query().insert({
        email: req.body.adminEmail,
        name: 'Administrator',
        providerKey: 'local',
        passwordRaw: req.body.adminPassword,
        localeCode: 'en',
        defaultEditor: 'markdown',
        tfaIsActive: false,
        isSystem: true,
        isActive: true
      })
      await WIKI.models.groups.relatedQuery('users').for(adminGroup.id).relate(1)

      await WIKI.models.groups.query().patch({ permissions: JSON.stringify(['read:pages', 'read:assets', 'read:comments']) }).where('id', guestGroup.id)

      await WIKI.models.storage.query().insert({
        isEnabled: true,
        key: 'local',
        mode: 'push',
        config: '{}'
      })

      await WIKI.models.authentication.query().insert({
        key: 'local',
        strategyKey: 'local',
        displayName: 'Local',
        order: 0,
        isEnabled: true,
        config: '{}',
        selfRegistration: false
      })

      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      })
    }
  })

  WIKI.servers.http = http.createServer(app)
}
