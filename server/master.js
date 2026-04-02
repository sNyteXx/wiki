const autoload = require('auto-load')
const bodyParser = require('body-parser')
const compression = require('compression')
const cookieParser = require('cookie-parser')
const cors = require('cors')
const express = require('express')
const session = require('express-session')
const KnexSessionStore = require('connect-session-knex')(session)
const favicon = require('serve-favicon')
const path = require('path')
const fs = require('fs-extra')
const _ = require('lodash')

/* global WIKI */

module.exports = async () => {
  // ----------------------------------------
  // Load core modules
  // ----------------------------------------

  WIKI.auth = require('./core/auth').init()
  WIKI.lang = require('./core/localization').init()
  WIKI.mail = require('./core/mail').init()
  WIKI.rag = require('./core/rag').init()
  WIKI.system = require('./core/system').init()

  // ----------------------------------------
  // Load middlewares
  // ----------------------------------------

  const mw = autoload(path.join(WIKI.SERVERPATH, '/middlewares'))
  const ctrl = autoload(path.join(WIKI.SERVERPATH, '/controllers'))

  // ----------------------------------------
  // Define Express App
  // ----------------------------------------

  const app = express()
  WIKI.app = app
  app.use(compression())

  // ----------------------------------------
  // Security
  // ----------------------------------------

  app.use(mw.security)
  app.use(cors({ origin: false }))
  app.options('*', cors({ origin: false }))
  if (WIKI.config.security.securityTrustProxy) {
    app.enable('trust proxy')
  }

  // ----------------------------------------
  // Public Assets
  // ----------------------------------------

  const faviconPath = path.join(WIKI.ROOTPATH, 'assets', 'favicon.ico')
  if (fs.existsSync(faviconPath)) {
    app.use(favicon(faviconPath))
  }
  app.use('/_assets/svg/twemoji', async (req, res, next) => {
    try {
      WIKI.asar.serve('twemoji', req, res, next)
    } catch (err) {
      res.sendStatus(404)
    }
  })
  app.use('/_assets', express.static(path.join(WIKI.ROOTPATH, 'assets'), {
    index: false,
    maxAge: '7d'
  }))

  // ----------------------------------------
  // SSL Handlers
  // ----------------------------------------

  app.use('/', ctrl.ssl)

  // ----------------------------------------
  // Passport Authentication
  // ----------------------------------------

  app.use(cookieParser())
  app.use(session({
    secret: WIKI.config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new KnexSessionStore({
      knex: WIKI.models.knex
    })
  }))
  app.use(WIKI.auth.passport.initialize())
  app.use(WIKI.auth.authenticate)

  // ----------------------------------------
  // GraphQL Server
  // ----------------------------------------

  app.use(bodyParser.json({ limit: WIKI.config.bodyParserLimit || '1mb' }))
  await WIKI.rag.bootstrap()
  await WIKI.servers.startGraphQL()

  // ----------------------------------------
  // SEO
  // ----------------------------------------

  app.use(mw.seo)

  // ----------------------------------------
  // View Engine Setup
  // ----------------------------------------

  app.set('views', path.join(WIKI.SERVERPATH, 'views'))
  app.set('view engine', 'pug')

  app.use(bodyParser.urlencoded({ extended: false, limit: '1mb' }))

  // ----------------------------------------
  // Localization
  // ----------------------------------------

  WIKI.lang.attachMiddleware(app)

  // ----------------------------------------
  // View accessible data
  // ----------------------------------------

  app.locals.siteConfig = {}
  app.locals.analyticsCode = {}
  app.locals.basedir = WIKI.ROOTPATH
  app.locals.config = WIKI.config
  app.locals.pageMeta = {
    title: '',
    description: WIKI.config.description,
    image: '',
    url: '/'
  }
  app.locals.devMode = WIKI.devMode

  // ----------------------------------------
  // Renderers
  // ----------------------------------------

  const renderer = autoload(path.join(WIKI.SERVERPATH, '/helpers'))
  app.use(renderer.common)

  // ----------------------------------------
  // Mount controllers
  // ----------------------------------------

  app.use(ctrl.common)
  app.use(ctrl.pages)
  app.use(ctrl.comments)
  app.use(ctrl.auth)
  app.use(ctrl.upload)
  app.use(ctrl.user)

  // ----------------------------------------
  // Error handling
  // ----------------------------------------

  app.use(mw.error)

  WIKI.servers.http = http.createServer(app)
}