const graphHelper = require('../../helpers/graph')
const _ = require('lodash')

/* global WIKI */

const SECRET_MASK = '********'

function maskSecret (value) {
  return _.isEmpty(value) ? '' : SECRET_MASK
}

function resolveSecretInput (nextValue, currentValue) {
  return nextValue === SECRET_MASK ? _.toString(currentValue || '') : _.toString(nextValue || '')
}

function resolveOptionalSecretInput (nextValue, currentValue) {
  if (_.isNil(nextValue)) {
    return _.toString(currentValue || '')
  }

  return resolveSecretInput(nextValue, currentValue)
}

function normalizePathPrefixes (value) {
  return _.uniq(
    (_.isArray(value) ? value : [])
      .map(prefix => _.trim(_.trim(_.toString(prefix || '')), '/'))
      .filter(prefix => !_.isEmpty(prefix))
  )
}

function isValidEmailAddress (value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_.trim(_.toString(value || '')))
}

function resolveProviderActionInput (input, currentConf) {
  const provider = _.toString(_.get(input, 'provider', '') || '').toLowerCase()

  if (provider === 'openai') {
    return {
      provider,
      baseUrl: _.toString(_.isNil(input.baseUrl) ? _.get(currentConf, 'openaiBaseUrl', 'https://api.openai.com/v1') : input.baseUrl),
      apiKey: resolveOptionalSecretInput(input.apiKey, currentConf.openaiApiKey),
      chatModel: _.toString(_.isNil(input.chatModel) ? _.get(currentConf, 'chatModel', 'gpt-4.1-mini') : input.chatModel),
      embeddingModel: _.toString(_.isNil(input.embeddingModel) ? _.get(currentConf, 'embeddingModel', 'text-embedding-3-small') : input.embeddingModel)
    }
  }

  if (provider === 'ollama') {
    return {
      provider,
      baseUrl: _.toString(_.isNil(input.baseUrl) ? _.get(currentConf, 'ollamaBaseUrl', 'http://localhost:11434') : input.baseUrl),
      apiKey: '',
      chatModel: _.toString(_.isNil(input.chatModel) ? _.get(currentConf, 'ollamaChatModel', 'llama3.1:8b') : input.chatModel),
      embeddingModel: _.toString(_.isNil(input.embeddingModel) ? _.get(currentConf, 'ollamaEmbeddingModel', 'nomic-embed-text') : input.embeddingModel)
    }
  }

  throw new Error(`Provider "${provider}" is not supported for this action.`)
}

function getDefaultStatus () {
  return {
    configuredEnabled: false,
    runtimeEnabled: false,
    canUse: false,
    searchButtonEnabled: false,
    streamingSupported: false,
    streamingEnabled: false,
    streamingSupportMessage: 'Streaming ist derzeit nicht verfügbar.',
    defaultAnswerMode: 'short',
    schemaReady: false,
    schemaEmbeddingDimensions: 0,
    hasPathRestrictions: false,
    currentPathAllowed: true,
    rebuildRecommended: false,
    statusMessage: 'RAG ist nicht initialisiert.',
    metadata: null,
    job: {
      status: 'idle',
      progress: 0,
      message: '',
      startedAt: null,
      completedAt: null,
      processedPages: 0,
      totalPages: 0,
      indexedPages: 0,
      indexedChunks: 0
    }
  }
}

module.exports = {
  Query: {
    async rag () { return {} }
  },
  Mutation: {
    async rag () { return {} }
  },
  RagQuery: {
    async config () {
      const rawConf = _.get(WIKI.config, 'rag', {})
      const runtimeConf = _.get(WIKI, 'rag.conf', rawConf)

      return {
        enabled: !!rawConf.enabled,
        autoBootstrap: !!runtimeConf.autoBootstrap,
        chatProvider: _.toString(runtimeConf.chatProvider || 'openai'),
        embeddingProvider: _.toString(runtimeConf.embeddingProvider || 'openai'),
        maxChunkChars: _.toInteger(runtimeConf.maxChunkChars || 1200),
        chunkOverlapChars: _.toInteger(runtimeConf.chunkOverlapChars || 150),
        maxCandidates: _.toInteger(runtimeConf.maxCandidates || 60),
        defaultTopK: _.toInteger(runtimeConf.defaultTopK || 8),
        embeddingModel: _.toString(runtimeConf.embeddingModel || 'text-embedding-3-small'),
        embeddingDimensions: _.toInteger(runtimeConf.embeddingDimensions || 1536),
        chatModel: _.toString(runtimeConf.chatModel || 'gpt-4.1-mini'),
        systemPrompt: _.toString(runtimeConf.systemPrompt || ''),
        defaultAnswerMode: _.toString(runtimeConf.defaultAnswerMode || 'short'),
        promptPreset: _.toString(runtimeConf.promptPreset || 'balanced'),
        noAnswerThreshold: _.toNumber(runtimeConf.noAnswerThreshold || 0.45),
        strictCitationMode: _.get(runtimeConf, 'strictCitationMode', true) !== false,
        queryAliasesText: _.toString(runtimeConf.queryAliasesText || ''),
        scheduledRebuildHours: Math.max(0, _.toInteger(runtimeConf.scheduledRebuildHours || 0)),
        enableSearchButton: !!runtimeConf.enableSearchButton,
        enableStreaming: _.get(runtimeConf, 'enableStreaming', true) !== false,
        openaiBaseUrl: _.toString(runtimeConf.openaiBaseUrl || 'https://api.openai.com/v1'),
        openaiApiKey: maskSecret(rawConf.openaiApiKey),
        claudeBaseUrl: _.toString(runtimeConf.claudeBaseUrl || 'https://api.anthropic.com/v1'),
        claudeApiKey: maskSecret(rawConf.claudeApiKey),
        claudeModel: _.toString(runtimeConf.claudeModel || 'claude-3-5-sonnet-latest'),
        geminiBaseUrl: _.toString(runtimeConf.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'),
        geminiApiKey: maskSecret(rawConf.geminiApiKey),
        geminiChatModel: _.toString(runtimeConf.geminiChatModel || 'gemini-1.5-pro'),
        geminiEmbeddingModel: _.toString(runtimeConf.geminiEmbeddingModel || 'text-embedding-004'),
        mistralBaseUrl: _.toString(runtimeConf.mistralBaseUrl || 'https://api.mistral.ai/v1'),
        mistralApiKey: maskSecret(rawConf.mistralApiKey),
        mistralChatModel: _.toString(runtimeConf.mistralChatModel || 'mistral-large-latest'),
        mistralEmbeddingModel: _.toString(runtimeConf.mistralEmbeddingModel || 'mistral-embed'),
        ollamaBaseUrl: _.toString(runtimeConf.ollamaBaseUrl || 'http://localhost:11434'),
        ollamaChatModel: _.toString(runtimeConf.ollamaChatModel || 'llama3.1:8b'),
        ollamaEmbeddingModel: _.toString(runtimeConf.ollamaEmbeddingModel || 'nomic-embed-text'),
        requestTimeoutMs: _.toInteger(runtimeConf.requestTimeoutMs || 30000),
        allowedGroups: (_.isArray(runtimeConf.allowedGroups) ? runtimeConf.allowedGroups : []).map(v => _.toInteger(v)).filter(v => v > 0),
        allowedPathPrefixes: normalizePathPrefixes(runtimeConf.allowedPathPrefixes),
        excludedPathPrefixes: normalizePathPrefixes(runtimeConf.excludedPathPrefixes)
      }
    },
    async status () {
      if (!WIKI.rag) {
        return getDefaultStatus()
      }

      return WIKI.rag.getStatusSnapshot()
    },
    async viewerState (obj, args, context) {
      if (!WIKI.rag) {
        return getDefaultStatus()
      }

      const status = await WIKI.rag.getStatusSnapshot({
        user: context.req.user,
        path: args.path
      })

      return {
        canUse: status.canUse,
        runtimeEnabled: status.runtimeEnabled,
        searchButtonEnabled: status.searchButtonEnabled,
        streamingSupported: status.streamingSupported,
        streamingEnabled: status.streamingEnabled,
        streamingSupportMessage: status.streamingSupportMessage,
        defaultAnswerMode: _.toString(status.defaultAnswerMode || 'short'),
        schemaReady: status.schemaReady,
        currentPathAllowed: status.currentPathAllowed,
        hasPathRestrictions: status.hasPathRestrictions,
        rebuildRecommended: status.rebuildRecommended,
        statusMessage: status.statusMessage
      }
    },
    async search (obj, args, context) {
      if (!WIKI.rag || !WIKI.rag.enabled) {
        return []
      }

      const results = await WIKI.rag.search(args.query, {
        locale: args.locale,
        path: args.path,
        pathMode: args.pathMode,
        topK: args.topK,
        user: context.req.user
      })

      return results.map(r => ({
        ...r,
        locale: r.locale
      }))
    },
    async ask (obj, args, context) {
      if (!WIKI.rag || !WIKI.rag.enabled) {
        return {
          answer: 'RAG ist nicht aktiviert.',
          chunks: []
        }
      }

      const response = await WIKI.rag.ask(args.query, {
        locale: args.locale,
        path: args.path,
        pathMode: args.pathMode,
        topK: args.topK,
        answerMode: args.answerMode,
        history: args.history,
        user: context.req.user
      })

      return {
        answer: response.answer,
        chunks: response.chunks.map(r => ({
          ...r,
          locale: r.locale
        }))
      }
    }
  },
  RagMutation: {
    async saveConfig (obj, args) {
      try {
        const conf = args.config
        const currentConf = _.get(WIKI.config, 'rag', {})

        _.set(WIKI.config, 'rag', {
          enabled: !!conf.enabled,
          autoBootstrap: !!conf.autoBootstrap,
          chatProvider: _.toString(conf.chatProvider || 'openai'),
          embeddingProvider: _.toString(conf.embeddingProvider || 'openai'),
          maxChunkChars: Math.max(200, _.toInteger(conf.maxChunkChars || 1200)),
          chunkOverlapChars: Math.max(0, _.toInteger(conf.chunkOverlapChars || 150)),
          maxCandidates: Math.max(5, _.toInteger(conf.maxCandidates || 60)),
          defaultTopK: Math.max(1, _.toInteger(conf.defaultTopK || 8)),
          embeddingModel: _.toString(conf.embeddingModel || 'text-embedding-3-small'),
          embeddingDimensions: Math.max(64, _.toInteger(conf.embeddingDimensions || 1536)),
          chatModel: _.toString(conf.chatModel || 'gpt-4.1-mini'),
          systemPrompt: _.toString(conf.systemPrompt || ''),
          defaultAnswerMode: _.toString(conf.defaultAnswerMode || 'short'),
          promptPreset: _.toString(conf.promptPreset || 'balanced'),
          noAnswerThreshold: _.clamp(_.toNumber(conf.noAnswerThreshold || 0.45), 0.05, 3),
          strictCitationMode: conf.strictCitationMode !== false,
          queryAliasesText: _.toString(conf.queryAliasesText || ''),
          scheduledRebuildHours: Math.max(0, _.toInteger(conf.scheduledRebuildHours || 0)),
          enableSearchButton: !!conf.enableSearchButton,
          enableStreaming: conf.enableStreaming !== false,
          openaiBaseUrl: _.toString(conf.openaiBaseUrl || 'https://api.openai.com/v1'),
          openaiApiKey: resolveSecretInput(conf.openaiApiKey, currentConf.openaiApiKey),
          claudeBaseUrl: _.toString(conf.claudeBaseUrl || 'https://api.anthropic.com/v1'),
          claudeApiKey: resolveSecretInput(conf.claudeApiKey, currentConf.claudeApiKey),
          claudeModel: _.toString(conf.claudeModel || 'claude-3-5-sonnet-latest'),
          geminiBaseUrl: _.toString(conf.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'),
          geminiApiKey: resolveSecretInput(conf.geminiApiKey, currentConf.geminiApiKey),
          geminiChatModel: _.toString(conf.geminiChatModel || 'gemini-1.5-pro'),
          geminiEmbeddingModel: _.toString(conf.geminiEmbeddingModel || 'text-embedding-004'),
          mistralBaseUrl: _.toString(conf.mistralBaseUrl || 'https://api.mistral.ai/v1'),
          mistralApiKey: resolveSecretInput(conf.mistralApiKey, currentConf.mistralApiKey),
          mistralChatModel: _.toString(conf.mistralChatModel || 'mistral-large-latest'),
          mistralEmbeddingModel: _.toString(conf.mistralEmbeddingModel || 'mistral-embed'),
          ollamaBaseUrl: _.toString(conf.ollamaBaseUrl || 'http://localhost:11434'),
          ollamaChatModel: _.toString(conf.ollamaChatModel || 'llama3.1:8b'),
          ollamaEmbeddingModel: _.toString(conf.ollamaEmbeddingModel || 'nomic-embed-text'),
          requestTimeoutMs: Math.max(1000, _.toInteger(conf.requestTimeoutMs || 30000)),
          allowedGroups: (_.isArray(conf.allowedGroups) ? conf.allowedGroups : []).map(v => _.toInteger(v)).filter(v => v > 0),
          allowedPathPrefixes: normalizePathPrefixes(conf.allowedPathPrefixes),
          excludedPathPrefixes: normalizePathPrefixes(conf.excludedPathPrefixes)
        })

        await WIKI.configSvc.saveToDb(['rag'])
        WIKI.rag.init()
        await WIKI.rag.pruneDisallowedChunks()
        await WIKI.rag.reconcileMetadataState()
        await WIKI.rag.bootstrap()

        return {
          responseResult: graphHelper.generateSuccess('RAG-Einstellungen wurden gespeichert.')
        }
      } catch (err) {
        return graphHelper.generateError(err)
      }
    },
    async rebuildIndex () {
      if (!WIKI.rag || !WIKI.rag.enabled) {
        return {
          responseResult: graphHelper.generateSuccess('RAG ist deaktiviert. Es gibt nichts neu aufzubauen.')
        }
      }

      try {
        await WIKI.rag.rebuildIndex({ allowSchemaCreate: true })
        return {
          responseResult: graphHelper.generateSuccess('Der RAG-Rebuild wurde im Hintergrund gestartet.')
        }
      } catch (err) {
        return graphHelper.generateError(err)
      }
    },
    async fetchProviderModels (obj, args) {
      if (!WIKI.rag) {
        throw new Error('RAG ist nicht initialisiert.')
      }

      const input = resolveProviderActionInput(args.input || {}, _.get(WIKI.config, 'rag', {}))
      return WIKI.rag.listProviderModels(input)
    },
    async testProviderConnection (obj, args) {
      if (!WIKI.rag) {
        throw new Error('RAG ist nicht initialisiert.')
      }

      const input = resolveProviderActionInput(args.input || {}, _.get(WIKI.config, 'rag', {}))
      return WIKI.rag.testProviderConnection(input)
    },
    async emailTranscript (obj, args, context) {
      try {
        if (!WIKI.rag || !WIKI.rag.enabled) {
          throw new Error('RAG ist nicht aktiviert.')
        }

        if (!WIKI.rag.isUserAllowed(context.req.user)) {
          throw new Error('Du darfst den Chatbot nicht verwenden.')
        }

        const input = args.input || {}
        if (!isValidEmailAddress(input.to)) {
          throw new WIKI.Error.MailInvalidRecipient()
        }

        await WIKI.rag.emailTranscript({
          to: _.trim(_.toString(input.to || '')),
          subject: _.trim(_.toString(input.subject || '')),
          messages: input.messages || [],
          requestedBy: context.req.user
        })

        return {
          responseResult: graphHelper.generateSuccess('Der Chatverlauf wurde per E-Mail versendet.')
        }
      } catch (err) {
        return graphHelper.generateError(err)
      }
    }
  }
}
