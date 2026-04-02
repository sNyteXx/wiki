const _ = require('lodash')
const crypto = require('crypto')
const he = require('he')
const striptags = require('striptags')

/* global WIKI */

const CHUNKING_STRATEGY = 'semantic-v1'
const DEFAULT_SYSTEM_PROMPT = 'Du bist ein Wiki-Assistent. Antworte ausschließlich mit Informationen aus den bereitgestellten Quellen. Antworte standardmäßig kurz, direkt und auf den Punkt. Nenne zuerst die eigentliche Antwort und erkläre nur ausführlicher, wenn der Nutzer ausdrücklich nach Details, Beispielen oder einer Schritt-für-Schritt-Anleitung fragt. Wenn eine Liste sinnvoll ist, nutze wenige Stichpunkte und hebe die Kernbegriffe am Anfang jedes Stichpunkts fett hervor. Erfinde keine Details. Leite keine Zahlen, Grenzwerte, Fristen, Namen oder Prozesse ab, wenn sie nicht explizit in den Quellen stehen. Wenn eine exakte Angabe in den Quellen nicht genannt wird, sage klar: "In den Quellen nicht spezifiziert." Wenn Informationen fehlen oder unklar sind, sage das klar. Gib niemals internes Denken, Chain-of-Thought, Reasoning oder Inhalte in <think>- oder <thinking>-Tags aus. Entferne solche internen Notizen komplett. Verwende sauberes Markdown. Nutze Quellenverweise nur inline als [Source 1], [Source 2], ... direkt hinter den betroffenen Aussagen. Wenn die gesamte Antwort oder ein ganzer Absatz nur auf derselben Quelle basiert, genügt ein einzelner Quellenverweis am Ende. Füge keine separate Liste "Verwendete Quellen" hinzu, da die UI die Quellen separat anzeigt.'
const ANSWER_MODE_VALUES = ['short', 'standard', 'detailed']
const PROMPT_PRESET_VALUES = ['balanced', 'concise', 'bullet', 'support']
const ANSWER_MODE_INSTRUCTIONS = {
  short: 'Antworte ohne Einleitung, maximal mit 3 Stichpunkten oder 5 kurzen Sätzen. Nur die direkt benötigte Antwort, keine Zusatzerklärung ohne Nachfrage.',
  standard: 'Antworte knapp und klar. Nutze bei Bedarf bis zu 5 Stichpunkte oder 8 Sätze, aber bleibe fokussiert auf die konkrete Frage.',
  detailed: 'Antworte strukturierter und etwas ausführlicher, aber bleibe weiterhin bei den Quellen. Gib mehr Kontext nur, wenn er für die Antwort nützlich ist.'
}
const PROMPT_PRESET_INSTRUCTIONS = {
  balanced: 'Antworte sachlich, klar und gut lesbar.',
  concise: 'Bevorzuge eine sehr knappe, entscheidungsorientierte Antwort mit minimalem Ballast.',
  bullet: 'Bevorzuge kurze Stichpunkte statt Fließtext. Hebe Schlüsselbegriffe am Anfang jedes Stichpunkts fett hervor.',
  support: 'Formuliere wie ein interner Support-Assistent: lösungsorientiert, konkret und in klaren Handlungsschritten, wenn Schritte explizit gefragt sind.'
}
const RAG_BLOCK_TAGS = 'p|div|section|article|aside|header|footer|main|nav|blockquote|pre|ul|ol|li|table|tr|td|th|h1|h2|h3|h4|h5|h6'
const RAG_DIAGRAM_CLASS_PATTERN = '(?:diagram|mermaid|uml-diagram|drawio|mxgraph)'
const RAG_HTML_NOISE_PATTERNS = [
  /<\s*(script|style|noscript|svg|canvas|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
  new RegExp(`<\\s*(?:pre|div|section|article|figure|span)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${RAG_DIAGRAM_CLASS_PATTERN}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\s*\\/\\s*(?:pre|div|section|article|figure|span)\\s*>`, 'gi'),
  /<\s*code\b[^>]*class\s*=\s*["'][^"']*\blanguage-(?:diagram|mermaid|plantuml|kroki|drawio)\b[^"']*["'][^>]*>[\s\S]*?<\s*\/\s*code\s*>/gi,
  new RegExp(`<\\s*img\\b[^>]*class\\s*=\\s*["'][^"']*\\b(?:${RAG_DIAGRAM_CLASS_PATTERN}|prefetch-candidate)\\b[^"']*["'][^>]*>`, 'gi'),
  /<\s*img\b[^>]*\bsrc\s*=\s*["']\s*data:[^"']+["'][^>]*>/gi
]
const RAG_TEXT_NOISE_PATTERNS = [
  /\bdata:[^;\s"'<>]+;base64,[A-Za-z0-9+/_:=.-]{80,}\b/gi,
  /\b[A-Za-z0-9+/_=-]{180,}\b/g
]
const DEFAULT_JOB_STATUS = {
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

module.exports = {
  conf: {
    enabled: false,
    autoBootstrap: false,
    chatProvider: 'openai',
    embeddingProvider: 'openai',
    maxChunkChars: 1200,
    chunkOverlapChars: 150,
    maxCandidates: 60,
    defaultTopK: 8,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
    chatModel: 'gpt-4.1-mini',
    systemPrompt: '',
    defaultAnswerMode: 'short',
    promptPreset: 'balanced',
    noAnswerThreshold: 0.45,
    strictCitationMode: true,
    queryAliasesText: '',
    scheduledRebuildHours: 0,
    enableSearchButton: false,
    enableStreaming: true,
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    claudeBaseUrl: 'https://api.anthropic.com/v1',
    claudeApiKey: '',
    claudeModel: 'claude-3-5-sonnet-latest',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    geminiApiKey: '',
    geminiChatModel: 'gemini-1.5-pro',
    geminiEmbeddingModel: 'text-embedding-004',
    mistralBaseUrl: 'https://api.mistral.ai/v1',
    mistralApiKey: '',
    mistralChatModel: 'mistral-large-latest',
    mistralEmbeddingModel: 'mistral-embed',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaChatModel: 'llama3.1:8b',
    ollamaEmbeddingModel: 'nomic-embed-text',
    requestTimeoutMs: 30000,
    allowedGroups: [],
    allowedPathPrefixes: [],
    excludedPathPrefixes: []
  },

  runtime: {
    enabled: false,
    message: 'RAG ist in der Konfiguration deaktiviert.'
  },

  jobStatus: { ...DEFAULT_JOB_STATUS },
  scheduledRebuildJob: null,

  init () {
    this.conf = {
      ...this.conf,
      ..._.get(WIKI.config, 'rag', {}),
      ...(process.env.OPENAI_API_KEY ? { openaiApiKey: process.env.OPENAI_API_KEY } : {}),
      ...(process.env.OPENAI_BASE_URL ? { openaiBaseUrl: process.env.OPENAI_BASE_URL } : {}),
      ...(process.env.ANTHROPIC_API_KEY ? { claudeApiKey: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.GEMINI_API_KEY ? { geminiApiKey: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.MISTRAL_API_KEY ? { mistralApiKey: process.env.MISTRAL_API_KEY } : {}),
      ...(process.env.OLLAMA_BASE_URL ? { ollamaBaseUrl: process.env.OLLAMA_BASE_URL } : {})
    }

    this.runtime = this.getRuntimeState()

    if (!this.runtime.enabled) {
      WIKI.logger.info(`(RAG) ${this.runtime.message}`)
      return this
    }

    WIKI.logger.info('(RAG) Initialized.')
    return this
  },

  get enabled () {
    return !!_.get(this, 'runtime.enabled', false)
  },

  getRuntimeState () {
    if (!this.conf.enabled) {
      return {
        enabled: false,
        message: 'In der Konfiguration deaktiviert.'
      }
    }

    if (WIKI.config.db.type !== 'postgres') {
      return {
        enabled: false,
        message: 'Deaktiviert: pgvector benötigt PostgreSQL.'
      }
    }

    if (!this.hasProviderCredentials(this.conf.embeddingProvider)) {
      return {
        enabled: false,
        message: `Deaktiviert: Zugangsdaten für den Embedding-Anbieter fehlen (${this.conf.embeddingProvider}).`
      }
    }

    if (!this.hasProviderCredentials(this.conf.chatProvider)) {
      return {
        enabled: false,
        message: `Deaktiviert: Zugangsdaten für den Chat-Anbieter fehlen (${this.conf.chatProvider}).`
      }
    }

    return {
      enabled: true,
      message: 'Konfiguriert.'
    }
  },

  getAllowedPathPrefixes () {
    return _.uniq(
      (this.conf.allowedPathPrefixes || [])
        .map(prefix => this.normalizePathPrefix(prefix))
        .filter(prefix => !_.isEmpty(prefix))
    )
  },

  getAllowedPathPrefixesFromValue (value) {
    return _.uniq(
      (_.isArray(value) ? value : [])
        .map(prefix => this.normalizePathPrefix(prefix))
        .filter(prefix => !_.isEmpty(prefix))
    )
  },

  getExcludedPathPrefixes () {
    return _.uniq(
      (this.conf.excludedPathPrefixes || [])
        .map(prefix => this.normalizePathPrefix(prefix))
        .filter(prefix => !_.isEmpty(prefix))
    )
  },

  getExcludedPathPrefixesFromValue (value) {
    return _.uniq(
      (_.isArray(value) ? value : [])
        .map(prefix => this.normalizePathPrefix(prefix))
        .filter(prefix => !_.isEmpty(prefix))
    )
  },

  getEmbeddingModelName (provider = this.conf.embeddingProvider) {
    switch (_.toString(provider || 'openai')) {
      case 'mistral':
        return _.toString(this.conf.mistralEmbeddingModel || 'mistral-embed')
      case 'gemini':
        return _.toString(this.conf.geminiEmbeddingModel || 'text-embedding-004')
      case 'ollama':
        return _.toString(this.conf.ollamaEmbeddingModel || 'nomic-embed-text')
      case 'openai':
      default:
        return _.toString(this.conf.embeddingModel || 'text-embedding-3-small')
    }
  },

  getChatModelName (provider = this.conf.chatProvider) {
    switch (_.toString(provider || 'openai')) {
      case 'claude':
        return _.toString(this.conf.claudeModel || 'claude-3-5-sonnet-latest')
      case 'gemini':
        return _.toString(this.conf.geminiChatModel || 'gemini-1.5-pro')
      case 'mistral':
        return _.toString(this.conf.mistralChatModel || 'mistral-large-latest')
      case 'ollama':
        return _.toString(this.conf.ollamaChatModel || 'llama3.1:8b')
      case 'openai':
      default:
        return _.toString(this.conf.chatModel || 'gpt-4.1-mini')
    }
  },

  getProviderConnectionConfig (provider, overrides = {}) {
    const normalizedProvider = _.toString(provider || '').toLowerCase()

    if (normalizedProvider === 'openai') {
      return {
        provider: 'openai',
        baseUrl: _.trimEnd(_.toString(overrides.baseUrl || this.conf.openaiBaseUrl || 'https://api.openai.com/v1'), '/'),
        apiKey: _.toString(overrides.apiKey || this.conf.openaiApiKey || ''),
        chatModel: _.toString(overrides.chatModel || this.conf.chatModel || 'gpt-4.1-mini'),
        embeddingModel: _.toString(overrides.embeddingModel || this.conf.embeddingModel || 'text-embedding-3-small')
      }
    }

    if (normalizedProvider === 'ollama') {
      return {
        provider: 'ollama',
        baseUrl: _.trimEnd(_.toString(overrides.baseUrl || this.conf.ollamaBaseUrl || 'http://localhost:11434'), '/'),
        apiKey: '',
        chatModel: _.toString(overrides.chatModel || this.conf.ollamaChatModel || 'llama3.1:8b'),
        embeddingModel: _.toString(overrides.embeddingModel || this.conf.ollamaEmbeddingModel || 'nomic-embed-text')
      }
    }

    throw new Error(`Provider "${normalizedProvider}" is not supported for model discovery.`)
  },

  isEmbeddingLikeModelId (value) {
    const modelId = _.toString(value || '').toLowerCase()
    if (!modelId) {
      return false
    }

    return modelId.includes('embed') ||
      modelId.includes('embedding') ||
      modelId.includes('nomic-embed') ||
      modelId.includes('mxbai-embed') ||
      modelId.includes('minilm') ||
      modelId.includes('bge')
  },

  formatProviderError (err) {
    return _.toString(
      _.get(err, 'error.error.message') ||
      _.get(err, 'error.message') ||
      _.get(err, 'message') ||
      'Unknown provider error.'
    )
  },

  hasProviderCredentials (provider) {
    switch (_.toString(provider || 'openai')) {
      case 'openai':
        return !_.isEmpty(this.conf.openaiApiKey)
      case 'claude':
        return !_.isEmpty(this.conf.claudeApiKey)
      case 'gemini':
        return !_.isEmpty(this.conf.geminiApiKey)
      case 'mistral':
        return !_.isEmpty(this.conf.mistralApiKey)
      case 'ollama':
        return !_.isEmpty(this.conf.ollamaBaseUrl)
      default:
        return false
    }
  },

  isUserAllowed (user) {
    const allowedGroups = _.isArray(this.conf.allowedGroups) ? this.conf.allowedGroups.map(v => _.toInteger(v)).filter(v => v > 0) : []

    if (allowedGroups.length < 1) {
      return true
    }

    const userGroups = (_.get(user, 'groups', []) || [])
      .map(grp => _.isObject(grp) ? _.toInteger(grp.id) : _.toInteger(grp))
      .filter(v => v > 0)

    return _.intersection(userGroups, allowedGroups).length > 0
  },

  normalizePathPrefix (value) {
    return _.trim(_.trim(_.toString(value || '')), '/')
  },

  normalizeSearchText (value) {
    return _.deburr(_.toString(value || '').toLowerCase())
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  },

  normalizeAnswerMode (value) {
    const normalized = _.toString(value || '').toLowerCase()
    return ANSWER_MODE_VALUES.includes(normalized) ? normalized : 'short'
  },

  normalizePromptPreset (value) {
    const normalized = _.toString(value || '').toLowerCase()
    return PROMPT_PRESET_VALUES.includes(normalized) ? normalized : 'balanced'
  },

  getDefaultAnswerMode () {
    return this.normalizeAnswerMode(this.conf.defaultAnswerMode)
  },

  getNoAnswerThreshold () {
    return _.clamp(_.toNumber(this.conf.noAnswerThreshold || 0.45), 0.05, 3)
  },

  getStreamingCapability (provider = this.conf.chatProvider) {
    switch (_.toString(provider || 'openai')) {
      case 'openai':
        return {
          supported: true,
          message: 'OpenAI-kompatible Chat-Completions-Endpunkte können Streaming unterstützen. Bei Gateways bitte mit "Verbindung testen" prüfen.'
        }
      case 'mistral':
        return {
          supported: true,
          message: 'Der Mistral-Chat-Completions-Endpunkt kann Streaming unterstützen.'
        }
      case 'ollama':
        return {
          supported: true,
          message: 'Ollama `/api/chat` unterstützt Streaming direkt.'
        }
      case 'claude':
        return {
          supported: false,
          message: 'Für Claude ist im Wiki-Chat aktuell noch kein Streaming-Handler eingebaut.'
        }
      case 'gemini':
        return {
          supported: false,
          message: 'Für Gemini ist im Wiki-Chat aktuell noch kein Streaming-Handler eingebaut.'
        }
      default:
        return {
          supported: false,
          message: `Für den Anbieter "${_.toString(provider || 'unbekannt')}" ist Streaming aktuell nicht verfügbar.`
        }
    }
  },

  isStreamingEnabled () {
    return !!this.conf.enableStreaming && this.getStreamingCapability().supported
  },

  parseAliasRules (value = this.conf.queryAliasesText) {
    return _.compact(
      _.toString(value || '')
        .split(/\r?\n/)
        .map(line => _.trim(line))
        .filter(line => !_.isEmpty(line) && !line.startsWith('#'))
        .map(line => {
          const separatorIndex = line.indexOf('=>')
          if (separatorIndex < 1) {
            return null
          }

          const triggerRaw = _.trim(line.slice(0, separatorIndex))
          const synonymRaw = _.trim(line.slice(separatorIndex + 2))

          if (_.isEmpty(triggerRaw) || _.isEmpty(synonymRaw)) {
            return null
          }

          const triggers = _.uniq(
            triggerRaw
              .split(',')
              .map(token => this.normalizeSearchText(token))
              .filter(token => !_.isEmpty(token))
          )
          const synonyms = _.uniq(
            synonymRaw
              .split(',')
              .map(token => _.trim(token))
              .filter(token => !_.isEmpty(token))
          )

          if (triggers.length < 1 || synonyms.length < 1) {
            return null
          }

          return {
            triggers,
            synonyms
          }
        })
    )
  },

  expandQueryWithAliases (query) {
    const original = _.trim(_.toString(query || ''))
    if (!original) {
      return original
    }

    const normalizedQuery = this.normalizeSearchText(original)
    if (!normalizedQuery) {
      return original
    }

    const additions = []
    for (const rule of this.parseAliasRules()) {
      const matchesRule = rule.triggers.some(trigger => normalizedQuery === trigger || normalizedQuery.includes(trigger))
      if (!matchesRule) {
        continue
      }

      for (const synonym of rule.synonyms) {
        const normalizedSynonym = this.normalizeSearchText(synonym)
        if (!normalizedSynonym || normalizedQuery.includes(normalizedSynonym)) {
          continue
        }
        additions.push(synonym)
      }
    }

    if (additions.length < 1) {
      return original
    }

    return `${original}\n${_.uniq(additions).join('\n')}`
  },

  getSearchTerms (query) {
    const exact = _.uniq(
      this.normalizeSearchText(query)
        .split(/\s+/)
        .filter(token => token.length > 1)
    )

    const derived = []

    for (const token of exact) {
      if (token.length < 10) {
        continue
      }

      for (const size of [8, 7, 6]) {
        if (token.length <= size + 2) {
          continue
        }

        derived.push(token.slice(0, size))
        derived.push(token.slice(token.length - size))
      }
    }

    return {
      exact,
      derived: _.uniq(derived.filter(token => token.length >= 5 && !exact.includes(token)))
    }
  },

  toSearchNgrams (value, size = 3) {
    const normalized = this.normalizeSearchText(value).replace(/\s+/g, '')
    if (!normalized) {
      return []
    }

    if (normalized.length <= size) {
      return [normalized]
    }

    const grams = []

    for (let idx = 0; idx <= normalized.length - size; idx++) {
      grams.push(normalized.slice(idx, idx + size))
    }

    return grams
  },

  computeDiceScore (left, right, size = 3) {
    const leftNgrams = this.toSearchNgrams(left, size)
    const rightNgrams = this.toSearchNgrams(right, size)

    if (leftNgrams.length < 1 || rightNgrams.length < 1) {
      return 0
    }

    const counts = new Map()
    for (const gram of leftNgrams) {
      counts.set(gram, (counts.get(gram) || 0) + 1)
    }

    let intersection = 0
    for (const gram of rightNgrams) {
      const count = counts.get(gram) || 0
      if (count > 0) {
        intersection += 1
        counts.set(gram, count - 1)
      }
    }

    return (2 * intersection) / (leftNgrams.length + rightNgrams.length)
  },

  computeLexicalSearchScore (query, candidate) {
    const terms = this.getSearchTerms(query)
    const title = this.normalizeSearchText(candidate.title)
    const path = this.normalizeSearchText(candidate.path)
    const chunk = this.normalizeSearchText(candidate.chunk || candidate.chunkText || '')

    let score = 0

    for (const term of terms.exact) {
      if (title.includes(term)) {
        score += 0.55
      }
      if (path.includes(term)) {
        score += 0.35
      }
      if (chunk.includes(term)) {
        score += 0.08
      }
    }

    for (const term of terms.derived) {
      if (title.includes(term)) {
        score += 0.18
      }
      if (path.includes(term)) {
        score += 0.12
      }
      if (chunk.includes(term)) {
        score += 0.03
      }
    }

    score += this.computeDiceScore(query, candidate.title, 3) * 0.45
    score += this.computeDiceScore(query, candidate.path, 3) * 0.2

    return _.toNumber(score.toFixed(6))
  },

  shouldKeepHybridSearchCandidate (candidate, topCandidate) {
    if (!topCandidate || candidate.id === topCandidate.id) {
      return true
    }

    const bestSemantic = _.toNumber(topCandidate.semanticScore || 0)
    const bestHybrid = _.toNumber(topCandidate.hybridScore || 0)
    const semanticScore = _.toNumber(candidate.semanticScore || 0)
    const lexicalScore = _.toNumber(candidate.lexicalScore || 0)
    const hybridScore = _.toNumber(candidate.hybridScore || 0)

    const hasLexicalSupport = lexicalScore >= 0.08
    const isSemanticallyClose = semanticScore >= Math.max(0.18, bestSemantic - 0.12)
    const isHybridClose = hybridScore >= Math.max(0.25, bestHybrid * 0.34)

    return isHybridClose && (hasLexicalSupport || isSemanticallyClose)
  },

  rerankSearchCandidates (query, candidates, { applyThreshold = true } = {}) {
    if (!Array.isArray(candidates) || candidates.length < 1) {
      return []
    }

    const scored = candidates
      .map(candidate => {
        const semanticScore = _.toNumber(candidate.score || 0)
        const lexicalScore = this.computeLexicalSearchScore(query, candidate)
        const hybridScore = _.toNumber((semanticScore + lexicalScore).toFixed(6))

        return {
          ...candidate,
          semanticScore,
          lexicalScore,
          hybridScore
        }
      })
      .sort((left, right) => {
        if (right.hybridScore !== left.hybridScore) {
          return right.hybridScore - left.hybridScore
        }
        return right.semanticScore - left.semanticScore
      })

    const filtered = applyThreshold ?
      scored.filter((candidate, idx) => idx === 0 || this.shouldKeepHybridSearchCandidate(candidate, scored[0])) :
      scored

    return filtered.map(({ semanticScore, lexicalScore, hybridScore, ...candidate }) => ({
      ...candidate,
      score: hybridScore
    }))
  },

  matchesPathPrefix (path, prefix) {
    const normalizedPath = this.normalizePathPrefix(path)
    const normalizedPrefix = this.normalizePathPrefix(prefix)

    if (!normalizedPath || !normalizedPrefix) {
      return false
    }

    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)
  },

  isPathAllowed (path) {
    if (this.isPathExcluded(path)) {
      return false
    }

    const prefixes = this.getAllowedPathPrefixes()
    if (prefixes.length < 1) {
      return true
    }

    return prefixes.some(prefix => this.matchesPathPrefix(path, prefix))
  },

  isPathExcluded (path) {
    const prefixes = this.getExcludedPathPrefixes()
    if (prefixes.length < 1) {
      return false
    }

    return prefixes.some(prefix => this.matchesPathPrefix(path, prefix))
  },

  getConfiguredEmbeddingDimensionsHint () {
    if (_.toString(this.conf.embeddingProvider || 'openai') === 'openai') {
      return Math.max(64, _.toInteger(this.conf.embeddingDimensions || 1536))
    }

    return 0
  },

  buildScopedPathClause (columnName, path, pathMode = 'PREFIX') {
    const normalizedPath = this.normalizePathPrefix(path)
    if (!normalizedPath) {
      return null
    }

    if (_.toUpper(pathMode || 'PREFIX') === 'EXACT') {
      return {
        clause: `${columnName} = ?`,
        params: [normalizedPath]
      }
    }

    return {
      clause: `(${columnName} = ? OR ${columnName} LIKE (? || '/%'))`,
      params: [normalizedPath, normalizedPath]
    }
  },

  buildAllowlistClause (columnName) {
    const prefixes = this.getAllowedPathPrefixes()
    if (prefixes.length < 1) {
      return null
    }

    const clauses = []
    const params = []

    for (const prefix of prefixes) {
      clauses.push(`(${columnName} = ? OR ${columnName} LIKE (? || '/%'))`)
      params.push(prefix, prefix)
    }

    return {
      clause: `(${clauses.join(' OR ')})`,
      params
    }
  },

  buildExcludeClause (columnName) {
    const prefixes = this.getExcludedPathPrefixes()
    if (prefixes.length < 1) {
      return null
    }

    const clauses = []
    const params = []

    for (const prefix of prefixes) {
      clauses.push(`(${columnName} = ? OR ${columnName} LIKE (? || '/%'))`)
      params.push(prefix, prefix)
    }

    return {
      clause: `NOT (${clauses.join(' OR ')})`,
      params
    }
  },

  buildScopeClause (columnName) {
    const clauses = []
    const params = []

    const allowlistClause = this.buildAllowlistClause(columnName)
    if (allowlistClause) {
      clauses.push(allowlistClause.clause)
      params.push(...allowlistClause.params)
    }

    const excludeClause = this.buildExcludeClause(columnName)
    if (excludeClause) {
      clauses.push(excludeClause.clause)
      params.push(...excludeClause.params)
    }

    if (clauses.length < 1) {
      return null
    }

    return {
      clause: clauses.join(' AND '),
      params
    }
  },

  applyPathScopeToQuery (builder, columnName = 'path') {
    const prefixes = this.getAllowedPathPrefixes()
    if (prefixes.length > 0) {
      builder.where(inner => {
        prefixes.forEach((prefix, idx) => {
          const method = idx === 0 ? 'where' : 'orWhere'
          inner[method](scope => {
            scope.where(columnName, prefix).orWhere(columnName, 'like', `${prefix}/%`)
          })
        })
      })
    }

    const excludedPrefixes = this.getExcludedPathPrefixes()
    if (excludedPrefixes.length > 0) {
      builder.whereNot(inner => {
        excludedPrefixes.forEach((prefix, idx) => {
          const method = idx === 0 ? 'where' : 'orWhere'
          inner[method](scope => {
            scope.where(columnName, prefix).orWhere(columnName, 'like', `${prefix}/%`)
          })
        })
      })
    }
  },

  async getSchemaState () {
    if (WIKI.config.db.type !== 'postgres') {
      return {
        exists: false,
        ready: false,
        dimensions: 0
      }
    }

    const hasTable = await WIKI.models.knex.schema.hasTable('ragChunks')
    if (!hasTable) {
      return {
        exists: false,
        ready: false,
        dimensions: 0
      }
    }

    let dimensions = 0

    try {
      const result = await WIKI.models.knex.raw(`
        SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS "columnType"
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'ragChunks'
          AND a.attname = 'embedding'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND n.nspname = current_schema()
        LIMIT 1
      `)
      const row = _.get(result, 'rows[0]', _.get(result, '[0]', {}))
      const typeName = _.toString(_.get(row, 'columnType', ''))
      const dimMatch = typeName.match(/^vector\((\d+)\)$/i)

      if (dimMatch) {
        dimensions = _.toInteger(dimMatch[1])
      }
    } catch (err) {
      WIKI.logger.warn(`(RAG) Failed to inspect schema dimensions: ${err.message}`)
    }

    return {
      exists: true,
      ready: dimensions > 0,
      dimensions
    }
  },

  async ensureMetadataTable () {
    const hasTable = await WIKI.models.knex.schema.hasTable('ragIndexMeta')
    if (!hasTable) {
      await WIKI.models.knex.schema.createTable('ragIndexMeta', table => {
        table.integer('id').primary()
        table.string('embeddingProvider', 64).notNullable().defaultTo('openai')
        table.string('embeddingModel', 255).notNullable().defaultTo('')
        table.integer('embeddingDimensions').notNullable().defaultTo(0)
        table.integer('maxChunkChars').notNullable().defaultTo(1200)
        table.integer('chunkOverlapChars').notNullable().defaultTo(150)
        table.string('chunkingStrategy', 64).notNullable().defaultTo(CHUNKING_STRATEGY)
        table.jsonb('allowedPathPrefixes').notNullable().defaultTo(WIKI.models.knex.raw("'[]'::jsonb"))
        table.jsonb('excludedPathPrefixes').notNullable().defaultTo(WIKI.models.knex.raw("'[]'::jsonb"))
        table.integer('indexedPages').notNullable().defaultTo(0)
        table.integer('indexedChunks').notNullable().defaultTo(0)
        table.string('status', 32).notNullable().defaultTo('idle')
        table.text('message').notNullable().defaultTo('')
        table.timestamp('lastBuildStartedAt')
        table.timestamp('lastBuildCompletedAt')
        table.timestamp('createdAt').notNullable().defaultTo(WIKI.models.knex.fn.now())
        table.timestamp('updatedAt').notNullable().defaultTo(WIKI.models.knex.fn.now())
      })
    }

    const hasExcludedPathPrefixes = await WIKI.models.knex.schema.hasColumn('ragIndexMeta', 'excludedPathPrefixes')
    if (!hasExcludedPathPrefixes) {
      await WIKI.models.knex.schema.table('ragIndexMeta', table => {
        table.jsonb('excludedPathPrefixes').notNullable().defaultTo(WIKI.models.knex.raw("'[]'::jsonb"))
      })
    }
  },

  async ensureMetadataRow () {
    await this.ensureMetadataTable()

    const row = await WIKI.models.knex('ragIndexMeta').where({ id: 1 }).first()
    if (row) {
      return row
    }

    const now = new Date().toISOString()

    await WIKI.models.knex('ragIndexMeta').insert({
      id: 1,
      embeddingProvider: _.toString(this.conf.embeddingProvider || 'openai'),
      embeddingModel: this.getEmbeddingModelName(),
      embeddingDimensions: 0,
      maxChunkChars: Math.max(200, _.toInteger(this.conf.maxChunkChars || 1200)),
      chunkOverlapChars: Math.max(0, _.toInteger(this.conf.chunkOverlapChars || 150)),
      chunkingStrategy: CHUNKING_STRATEGY,
      allowedPathPrefixes: this.getAllowedPathPrefixes(),
      excludedPathPrefixes: this.getExcludedPathPrefixes(),
      indexedPages: 0,
      indexedChunks: 0,
      status: 'idle',
      message: '',
      createdAt: now,
      updatedAt: now
    })

    return WIKI.models.knex('ragIndexMeta').where({ id: 1 }).first()
  },

  normalizeMetadataRow (row) {
    if (!row) {
      return {
        exists: false,
        embeddingProvider: '',
        embeddingModel: '',
        embeddingDimensions: 0,
        maxChunkChars: 0,
        chunkOverlapChars: 0,
        chunkingStrategy: '',
        allowedPathPrefixes: [],
        excludedPathPrefixes: [],
        indexedPages: 0,
        indexedChunks: 0,
        status: 'idle',
        message: '',
        lastBuildStartedAt: null,
        lastBuildCompletedAt: null,
        createdAt: null,
        updatedAt: null
      }
    }

    return {
      exists: true,
      embeddingProvider: _.toString(row.embeddingProvider || ''),
      embeddingModel: _.toString(row.embeddingModel || ''),
      embeddingDimensions: _.toInteger(row.embeddingDimensions || 0),
      maxChunkChars: _.toInteger(row.maxChunkChars || 0),
      chunkOverlapChars: _.toInteger(row.chunkOverlapChars || 0),
      chunkingStrategy: _.toString(row.chunkingStrategy || ''),
      allowedPathPrefixes: (_.isString(row.allowedPathPrefixes) ? JSON.parse(row.allowedPathPrefixes) : row.allowedPathPrefixes || [])
        .map(prefix => this.normalizePathPrefix(prefix))
        .filter(prefix => !_.isEmpty(prefix)),
      excludedPathPrefixes: (_.isString(row.excludedPathPrefixes) ? JSON.parse(row.excludedPathPrefixes) : row.excludedPathPrefixes || [])
        .map(prefix => this.normalizePathPrefix(prefix))
        .filter(prefix => !_.isEmpty(prefix)),
      indexedPages: _.toInteger(row.indexedPages || 0),
      indexedChunks: _.toInteger(row.indexedChunks || 0),
      status: _.toString(row.status || 'idle'),
      message: _.toString(row.message || ''),
      lastBuildStartedAt: row.lastBuildStartedAt || null,
      lastBuildCompletedAt: row.lastBuildCompletedAt || null,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null
    }
  },

  async getMetadataState () {
    if (WIKI.config.db.type !== 'postgres') {
      return this.normalizeMetadataRow(null)
    }

    const hasTable = await WIKI.models.knex.schema.hasTable('ragIndexMeta')
    if (!hasTable) {
      return this.normalizeMetadataRow(null)
    }

    const row = await WIKI.models.knex('ragIndexMeta').where({ id: 1 }).first()
    return this.normalizeMetadataRow(row)
  },

  async updateMetadataState (patch = {}) {
    await this.ensureMetadataRow()

    const data = {
      ...patch,
      updatedAt: new Date().toISOString()
    }

    if (_.has(data, 'allowedPathPrefixes')) {
      data.allowedPathPrefixes = this.getAllowedPathPrefixesFromValue(data.allowedPathPrefixes)
    }

    if (_.has(data, 'excludedPathPrefixes')) {
      data.excludedPathPrefixes = this.getExcludedPathPrefixesFromValue(data.excludedPathPrefixes)
    }

    await WIKI.models.knex('ragIndexMeta').where({ id: 1 }).update(data)

    return this.getMetadataState()
  },

  isEmbeddingMetadataCurrent (metadata) {
    if (!metadata.exists) {
      return false
    }

    if (metadata.embeddingProvider !== _.toString(this.conf.embeddingProvider || 'openai')) {
      return false
    }

    if (metadata.embeddingModel !== this.getEmbeddingModelName()) {
      return false
    }

    if (_.toString(this.conf.embeddingProvider || 'openai') === 'openai' && metadata.embeddingDimensions !== this.getConfiguredEmbeddingDimensionsHint()) {
      return false
    }

    return true
  },

  isChunkMetadataCurrent (metadata) {
    if (!metadata.exists) {
      return false
    }

    return metadata.chunkingStrategy === CHUNKING_STRATEGY &&
      metadata.maxChunkChars === Math.max(200, _.toInteger(this.conf.maxChunkChars || 1200)) &&
      metadata.chunkOverlapChars === Math.max(0, _.toInteger(this.conf.chunkOverlapChars || 150))
  },

  arePathPrefixSetsEqual (left, right) {
    const leftSet = _.sortBy(this.getAllowedPathPrefixesFromValue(left))
    const rightSet = _.sortBy(this.getAllowedPathPrefixesFromValue(right))

    return JSON.stringify(leftSet) === JSON.stringify(rightSet)
  },

  arePrefixesCoveredBySource (candidatePrefixes, sourcePrefixes) {
    const candidate = this.getAllowedPathPrefixesFromValue(candidatePrefixes)
    const source = this.getAllowedPathPrefixesFromValue(sourcePrefixes)

    if (candidate.length < 1) {
      return true
    }

    if (source.length < 1) {
      return false
    }

    return candidate.every(prefix => source.some(sourcePrefix => this.matchesPathPrefix(prefix, sourcePrefix)))
  },

  isAllowlistSubset (candidatePrefixes, sourcePrefixes) {
    const candidate = this.getAllowedPathPrefixesFromValue(candidatePrefixes)
    const source = this.getAllowedPathPrefixesFromValue(sourcePrefixes)

    if (source.length < 1) {
      return true
    }

    if (candidate.length < 1) {
      return false
    }

    return this.arePrefixesCoveredBySource(candidate, source)
  },

  isRebuildRecommended (metadata) {
    if (!metadata.exists) {
      return false
    }

    return !this.isEmbeddingMetadataCurrent(metadata) ||
      !this.isChunkMetadataCurrent(metadata) ||
      !this.arePathPrefixSetsEqual(metadata.allowedPathPrefixes, this.getAllowedPathPrefixes()) ||
      !this.arePathPrefixSetsEqual(metadata.excludedPathPrefixes, this.getExcludedPathPrefixes())
  },

  getJobStatus () {
    return {
      ...DEFAULT_JOB_STATUS,
      ...this.jobStatus
    }
  },

  setJobStatus (patch = {}) {
    this.jobStatus = {
      ...DEFAULT_JOB_STATUS,
      ...this.jobStatus,
      ...patch
    }

    return this.getJobStatus()
  },

  async getIndexCounts () {
    const schemaState = await this.getSchemaState()
    if (!schemaState.ready) {
      return {
        pages: 0,
        chunks: 0
      }
    }

    const countChunks = await WIKI.models.knex('ragChunks').count({ count: 'id' }).first()
    const countPages = await WIKI.models.knex('ragChunks').countDistinct({ count: 'pageId' }).first()

    return {
      pages: _.toInteger(_.get(countPages, 'count', 0)),
      chunks: _.toInteger(_.get(countChunks, 'count', 0))
    }
  },

  async getStatusSnapshot ({ user, path } = {}) {
    const schemaState = await this.getSchemaState()
    const metadata = await this.getMetadataState()
    const job = this.getJobStatus()
    const streamingCapability = this.getStreamingCapability()
    const hasPathRestrictions = this.getAllowedPathPrefixes().length > 0 || this.getExcludedPathPrefixes().length > 0
    const currentPathAllowed = _.isEmpty(path) ? true : this.isPathAllowed(path)
    const canUse = this.enabled && schemaState.ready && this.isUserAllowed(user)
    const rebuildRecommended = schemaState.ready && (
      this.isRebuildRecommended(metadata) ||
      ['running', 'error', 'stale'].includes(_.toString(metadata.status || ''))
    )

    let statusMessage = this.runtime.message

    if (job.status === 'running') {
      statusMessage = job.message || 'Der RAG-Index wird gerade neu aufgebaut.'
    } else if (this.enabled && !schemaState.ready) {
      statusMessage = 'Konfiguriert, aber das Storage ist noch nicht initialisiert. Klicke auf "Initialisieren & Index aufbauen".'
    } else if (metadata.status === 'running') {
      statusMessage = 'Der letzte Rebuild wurde nicht sauber abgeschlossen. Bitte den Index erneut aufbauen.'
    } else if (metadata.status === 'error') {
      statusMessage = metadata.message || 'Der letzte Rebuild ist fehlgeschlagen. Bitte den Index erneut aufbauen.'
    } else if (rebuildRecommended) {
      statusMessage = 'Der Index passt nicht mehr zu den aktuellen Embedding-, Chunking- oder Pfad-Einstellungen. Bitte den Index neu aufbauen.'
    } else if (this.enabled && schemaState.ready) {
      statusMessage = `Bereit. Das Storage ist mit ${schemaState.dimensions} Dimensionen initialisiert.`
    }

    if (user && !this.isUserAllowed(user)) {
      statusMessage = 'Du darfst den Chatbot nicht verwenden.'
    } else if (user && hasPathRestrictions && !currentPathAllowed) {
      statusMessage = 'Diese Seite liegt außerhalb des freigegebenen Chatbot-Bereichs.'
    }

    return {
      configuredEnabled: !!this.conf.enabled,
      runtimeEnabled: this.enabled,
      canUse,
      searchButtonEnabled: this.enabled && schemaState.ready && !!this.conf.enableSearchButton && this.isUserAllowed(user),
      streamingSupported: !!streamingCapability.supported,
      streamingEnabled: this.enabled && schemaState.ready && this.isStreamingEnabled() && this.isUserAllowed(user),
      streamingSupportMessage: streamingCapability.message,
      defaultAnswerMode: this.getDefaultAnswerMode(),
      schemaReady: !!schemaState.ready,
      schemaEmbeddingDimensions: _.toInteger(schemaState.dimensions || 0),
      hasPathRestrictions,
      currentPathAllowed,
      rebuildRecommended,
      statusMessage,
      metadata,
      job
    }
  },

  async detectEmbeddingDimensions () {
    const embedding = await this.embedText('rag schema probe')
    if (!Array.isArray(embedding) || embedding.length < 1) {
      throw new Error('Die Embedding-Dimensionen des aktuellen Anbieters konnten nicht erkannt werden.')
    }

    return embedding.length
  },

  async ensureSchema ({ allowCreate = false, recreateOnDimensionChange = false } = {}) {
    let schemaState = await this.getSchemaState()
    if (!allowCreate) {
      return schemaState
    }

    if (WIKI.config.db.type !== 'postgres') {
      throw new Error('RAG-Storage benötigt PostgreSQL.')
    }

    const requiredDimensions = await this.detectEmbeddingDimensions()

    if (schemaState.exists && schemaState.dimensions > 0 && schemaState.dimensions !== requiredDimensions) {
      if (!recreateOnDimensionChange) {
        throw new Error(`Dimensionen passen nicht: Storage nutzt ${schemaState.dimensions}, der aktuelle Embedding-Anbieter liefert ${requiredDimensions}. Bitte den Index neu aufbauen.`)
      }

      WIKI.logger.warn(`(RAG) Storage wird für ${requiredDimensions} Embedding-Dimensionen neu erstellt.`)
      await WIKI.models.knex.schema.dropTableIfExists('ragChunks')
      schemaState = {
        exists: false,
        ready: false,
        dimensions: 0
      }
    }

    await this.ensureMetadataTable()
    await this.ensureMetadataRow()

    if (!schemaState.exists) {
      await WIKI.models.knex.raw('CREATE EXTENSION IF NOT EXISTS vector')

      await WIKI.models.knex.schema.createTable('ragChunks', table => {
        table.increments('id').primary()
        table.integer('pageId').unsigned().notNullable().references('id').inTable('pages').onDelete('CASCADE')
        table.integer('chunkIndex').notNullable().defaultTo(0)
        table.string('chunkHash', 64).notNullable().unique()
        table.string('path', 2048).notNullable()
        table.string('localeCode', 32).notNullable()
        table.string('title', 255).notNullable()
        table.text('chunkText').notNullable()
        table.jsonb('tags').notNullable().defaultTo(WIKI.models.knex.raw("'[]'::jsonb"))
        table.specificType('embedding', `vector(${requiredDimensions})`).notNullable()
        table.timestamp('createdAt').notNullable().defaultTo(WIKI.models.knex.fn.now())
        table.timestamp('updatedAt').notNullable().defaultTo(WIKI.models.knex.fn.now())

        table.index(['pageId'])
        table.index(['localeCode'])
        table.index(['path'])
      })

      await WIKI.models.knex.raw('CREATE INDEX IF NOT EXISTS "ragChunks_embedding_idx" ON "ragChunks" USING ivfflat ("embedding" vector_cosine_ops)')
    }

    return this.getSchemaState()
  },

  assertEmbeddingDimensions (embedding, schemaState) {
    const actualDimensions = Array.isArray(embedding) ? embedding.length : 0

    if (schemaState.ready && actualDimensions > 0 && actualDimensions !== schemaState.dimensions) {
      throw new Error(`Dimensionen passen nicht: Storage nutzt ${schemaState.dimensions}, der aktuelle Embedding-Anbieter liefert ${actualDimensions}. Bitte den Index neu aufbauen.`)
    }
  },

  async bootstrap () {
    await this.configureScheduledRebuildJob()

    if (!this.enabled) {
      return
    }

    const schemaState = await this.ensureSchema()
    if (!schemaState.ready) {
      WIKI.logger.info('(RAG) Storage ist noch nicht initialisiert. Nutze die Admin-Aktion zum Initialisieren und Index-Aufbau.')
      return
    }

    if (this.conf.autoBootstrap) {
      const countRow = await WIKI.models.knex('ragChunks').count({ count: 'id' }).first()
      const count = _.toInteger(_.get(countRow, 'count', 0))

      if (count < 1 && this.getJobStatus().status !== 'running') {
        WIKI.logger.info('(RAG) Leerer Index erkannt, starte Hintergrund-Rebuild...')
        this.startRebuildJob({ allowSchemaCreate: false }).catch(err => {
          WIKI.logger.error(`(RAG) Auto-Bootstrap-Rebuild konnte nicht gestartet werden: ${err.message}`)
        })
      }
    }
  },

  async configureScheduledRebuildJob () {
    if (this.scheduledRebuildJob) {
      await this.scheduledRebuildJob.stop()
      this.scheduledRebuildJob = null
    }

    const scheduledRebuildHours = Math.max(0, _.toInteger(this.conf.scheduledRebuildHours || 0))
    if (!this.enabled || scheduledRebuildHours < 1 || !WIKI.scheduler) {
      return
    }

    this.scheduledRebuildJob = WIKI.scheduler.registerJob({
      name: 'rag-rebuild',
      immediate: false,
      schedule: `PT${scheduledRebuildHours}H`,
      repeat: true,
      worker: false
    })

    WIKI.logger.info(`(RAG) Geplanter Sicherheits-Rebuild alle ${scheduledRebuildHours} Stunde(n) aktiviert.`)
  },

  async rebuildIndex ({ allowSchemaCreate = false } = {}) {
    if (!this.enabled) {
      throw new Error('RAG ist nicht aktiviert.')
    }

    return this.startRebuildJob({ allowSchemaCreate })
  },

  async startRebuildJob ({ allowSchemaCreate = false } = {}) {
    if (this.getJobStatus().status === 'running') {
      throw new Error('Es läuft bereits ein anderer RAG-Rebuild.')
    }

    const startedAt = new Date().toISOString()
    this.setJobStatus({
      status: 'running',
      progress: 0,
      message: 'RAG-Rebuild wird vorbereitet...',
      startedAt,
      completedAt: null,
      processedPages: 0,
      totalPages: 0,
      indexedPages: 0,
      indexedChunks: 0
    })

    void this.runRebuildJob({ allowSchemaCreate, startedAt })

    return this.getJobStatus()
  },

  async runRebuildJob ({ allowSchemaCreate = false, startedAt }) {
    try {
      const schemaState = await this.ensureSchema({
        allowCreate: allowSchemaCreate,
        recreateOnDimensionChange: allowSchemaCreate
      })

      if (!schemaState.ready) {
        throw new Error('Das RAG-Storage ist noch nicht initialisiert. Bitte zuerst "Initialisieren & Index aufbauen" ausführen.')
      }

      await this.updateMetadataState({
        embeddingProvider: _.toString(this.conf.embeddingProvider || 'openai'),
        embeddingModel: this.getEmbeddingModelName(),
        embeddingDimensions: _.toInteger(schemaState.dimensions || 0),
        maxChunkChars: Math.max(200, _.toInteger(this.conf.maxChunkChars || 1200)),
        chunkOverlapChars: Math.max(0, _.toInteger(this.conf.chunkOverlapChars || 150)),
        chunkingStrategy: CHUNKING_STRATEGY,
        allowedPathPrefixes: this.getAllowedPathPrefixes(),
        excludedPathPrefixes: this.getExcludedPathPrefixes(),
        indexedPages: 0,
        indexedChunks: 0,
        status: 'running',
        message: 'Rebuild gestartet.',
        lastBuildStartedAt: startedAt,
        lastBuildCompletedAt: null
      })

      WIKI.logger.info('(RAG) pgvector-Index wird im Hintergrund neu aufgebaut...')
      await WIKI.models.knex('ragChunks').del()

      const pagesQuery = WIKI.models.pages.query().select('id').where({
        isPublished: true,
        isPrivate: false
      })
      this.applyPathScopeToQuery(pagesQuery, 'path')

      const pages = await pagesQuery
      const totalPages = pages.length

      this.setJobStatus({
        progress: totalPages > 0 ? 2 : 100,
        totalPages,
        message: totalPages > 0 ? `${totalPages} Seiten werden indexiert...` : 'Keine Seiten entsprechen dem aktuellen Bereich.'
      })

      let indexedPages = 0
      let indexedChunks = 0

      for (let idx = 0; idx < pages.length; idx++) {
        const result = await this.upsertPageById(pages[idx].id, { schemaState })

        if (result.indexedChunks > 0) {
          indexedPages += 1
          indexedChunks += result.indexedChunks
        }

        this.setJobStatus({
          processedPages: idx + 1,
          indexedPages,
          indexedChunks,
          progress: Math.min(99, Math.max(2, Math.round(((idx + 1) / Math.max(totalPages, 1)) * 100))),
          message: `${idx + 1} / ${totalPages} Seiten indexiert...`
        })
      }

      const completedAt = new Date().toISOString()

      await this.updateMetadataState({
        embeddingProvider: _.toString(this.conf.embeddingProvider || 'openai'),
        embeddingModel: this.getEmbeddingModelName(),
        embeddingDimensions: _.toInteger(schemaState.dimensions || 0),
        maxChunkChars: Math.max(200, _.toInteger(this.conf.maxChunkChars || 1200)),
        chunkOverlapChars: Math.max(0, _.toInteger(this.conf.chunkOverlapChars || 150)),
        chunkingStrategy: CHUNKING_STRATEGY,
        allowedPathPrefixes: this.getAllowedPathPrefixes(),
        excludedPathPrefixes: this.getExcludedPathPrefixes(),
        indexedPages,
        indexedChunks,
        status: 'ready',
        message: `Index bereit. ${indexedPages} Seiten und ${indexedChunks} Chunks wurden indexiert.`,
        lastBuildStartedAt: startedAt,
        lastBuildCompletedAt: completedAt
      })

      this.setJobStatus({
        status: 'success',
        progress: 100,
        message: `RAG-Rebuild abgeschlossen. ${indexedPages} Seiten und ${indexedChunks} Chunks wurden indexiert.`,
        completedAt,
        processedPages: totalPages,
        indexedPages,
        indexedChunks
      })

      WIKI.logger.info(`(RAG) Rebuild abgeschlossen. ${indexedPages} Seiten und ${indexedChunks} Chunks wurden indexiert.`)
    } catch (err) {
      const completedAt = new Date().toISOString()

      try {
        const metadata = await this.getMetadataState()
        if (metadata.exists) {
          await this.updateMetadataState({
            status: 'error',
            message: err.message,
            lastBuildCompletedAt: completedAt
          })
        }
      } catch (metaErr) {
        WIKI.logger.warn(`(RAG) Fehlerstatus des Rebuilds konnte nicht gespeichert werden: ${metaErr.message}`)
      }

      this.setJobStatus({
        status: 'error',
        progress: 100,
        message: err.message,
        completedAt
      })

      WIKI.logger.error(`(RAG) Rebuild fehlgeschlagen: ${err.message}`)
    }
  },

  async pruneDisallowedChunks () {
    const schemaState = await this.getSchemaState()
    if (!schemaState.ready) {
      return 0
    }

    const scopeClause = this.buildScopeClause('"path"')
    if (!scopeClause) {
      return 0
    }

    const result = await WIKI.models.knex.raw(
      `DELETE FROM "ragChunks" WHERE NOT (${scopeClause.clause})`,
      scopeClause.params
    )

    return _.toInteger(_.get(result, 'rowCount', 0))
  },

  async reconcileMetadataState () {
    const schemaState = await this.getSchemaState()
    if (!schemaState.ready) {
      return this.getMetadataState()
    }

    const metadata = await this.getMetadataState()
    if (!metadata.exists) {
      return metadata
    }

    const currentAllowedPrefixes = this.getAllowedPathPrefixes()
    const currentExcludedPrefixes = this.getExcludedPathPrefixes()
    const counts = await this.getIndexCounts()

    if (!this.isEmbeddingMetadataCurrent(metadata) || !this.isChunkMetadataCurrent(metadata)) {
      return this.updateMetadataState({
        status: 'stale',
        message: 'Embedding- oder Chunking-Einstellungen wurden geändert. Bitte den Index neu aufbauen.',
        indexedPages: counts.pages,
        indexedChunks: counts.chunks
      })
    }

    const allowedChanged = !this.arePathPrefixSetsEqual(metadata.allowedPathPrefixes, currentAllowedPrefixes)
    const excludedChanged = !this.arePathPrefixSetsEqual(metadata.excludedPathPrefixes, currentExcludedPrefixes)

    if (allowedChanged || excludedChanged) {
      const allowlistCanBeApplied = !allowedChanged || this.isAllowlistSubset(currentAllowedPrefixes, metadata.allowedPathPrefixes)
      const excludeCanBeApplied = !excludedChanged || this.arePrefixesCoveredBySource(metadata.excludedPathPrefixes, currentExcludedPrefixes)

      if (allowlistCanBeApplied && excludeCanBeApplied) {
        await this.pruneDisallowedChunks()
        const updatedCounts = await this.getIndexCounts()

        return this.updateMetadataState({
          allowedPathPrefixes: currentAllowedPrefixes,
          excludedPathPrefixes: currentExcludedPrefixes,
          indexedPages: updatedCounts.pages,
          indexedChunks: updatedCounts.chunks,
          status: 'ready',
          message: 'Index-Bereich aktualisiert.'
        })
      }

      const scopeReasons = []
      if (allowedChanged && !allowlistCanBeApplied) {
        scopeReasons.push('path scope was widened')
      }
      if (excludedChanged && !excludeCanBeApplied) {
        scopeReasons.push('path exclusions were relaxed')
      }

      return this.updateMetadataState({
        status: 'stale',
        message: `${_.upperFirst(scopeReasons.join(' und '))}. Bitte den Index neu aufbauen, damit neu erlaubte Seiten aufgenommen werden.`,
        indexedPages: counts.pages,
        indexedChunks: counts.chunks
      })
    }

    return this.updateMetadataState({
      indexedPages: counts.pages,
      indexedChunks: counts.chunks,
      status: metadata.status === 'error' ? 'error' : 'ready',
      message: metadata.status === 'error' ? metadata.message : 'Index bereit.'
    })
  },

  async upsertPageById (pageId, { schemaState = null } = {}) {
    if (!this.enabled) {
      return {
        indexedChunks: 0
      }
    }

    const activeSchemaState = schemaState || await this.ensureSchema()
    if (!activeSchemaState.ready) {
      return {
        indexedChunks: 0
      }
    }

    const page = await WIKI.models.pages.query()
      .findById(pageId)
      .select(
        'pages.id',
        'pages.path',
        'pages.localeCode',
        'pages.title',
        'pages.render',
        'pages.updatedAt',
        'pages.isPublished',
        'pages.isPrivate'
      )
      .withGraphJoined('tags')
      .modifyGraph('tags', builder => {
        builder.select('tag')
      })

    if (!page || !page.isPublished || page.isPrivate || _.isEmpty(page.render) || !this.isPathAllowed(page.path)) {
      await this.deletePageIndex(pageId)
      return {
        indexedChunks: 0
      }
    }

    const ragText = this.extractRagText(page.render)
    const chunks = this.chunkText(ragText)

    if (chunks.length < 1) {
      await this.deletePageIndex(pageId)
      return {
        indexedChunks: 0
      }
    }

    await this.deletePageIndex(pageId)

    const tags = _.map(page.tags || [], 'tag')
    const now = new Date().toISOString()

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkText = chunks[idx]
      const embedding = await this.embedText(chunkText)
      this.assertEmbeddingDimensions(embedding, activeSchemaState)

      const vectorLiteral = this.toVectorLiteral(embedding)
      const chunkHash = crypto
        .createHash('sha256')
        .update(`${page.id}:${idx}:${chunkText}`)
        .digest('hex')

      await WIKI.models.knex.raw(
        `INSERT INTO "ragChunks" (
          "pageId", "chunkIndex", "path", "localeCode", "title", "chunkText", "chunkHash", "tags", "embedding", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::vector, ?, ?)`,
        [
          page.id,
          idx,
          page.path,
          page.localeCode,
          page.title,
          chunkText,
          chunkHash,
          JSON.stringify(tags),
          vectorLiteral,
          now,
          now
        ]
      )
    }

    return {
      indexedChunks: chunks.length
    }
  },

  async deletePageIndex (pageId) {
    const schemaState = await this.getSchemaState()
    if (!schemaState.ready) {
      return
    }

    await WIKI.models.knex('ragChunks').where({ pageId }).del()
  },

  stripRagHtmlNoise (html = '') {
    let sanitized = _.toString(html || '')

    for (const pattern of RAG_HTML_NOISE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '\n')
    }

    return sanitized
  },

  stripRagTextNoise (text = '') {
    let sanitized = _.toString(text || '')

    for (const pattern of RAG_TEXT_NOISE_PATTERNS) {
      sanitized = sanitized.replace(pattern, ' ')
    }

    return sanitized
  },

  extractRagText (html = '') {
    const cleanedHtml = this.stripRagHtmlNoise(html)
    const text = this.stripRagTextNoise(he.decode(
      striptags(
        cleanedHtml
          .replace(/<\s*br\s*\/?>/gi, '\n')
          .replace(new RegExp(`<\\s*\\/\\s*(${RAG_BLOCK_TAGS})\\s*>`, 'gi'), '\n')
          .replace(new RegExp(`<\\s*(${RAG_BLOCK_TAGS})(\\s|>)`, 'gi'), '\n<$1$2'),
        [],
        ' '
      )
    ))

    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  },

  splitIntoSemanticUnits (text = '') {
    const blocks = _.toString(text || '')
      .split(/\n{2,}/)
      .map(block => block.replace(/\s+/g, ' ').trim())
      .filter(block => block.length > 0)

    const units = []

    for (const block of blocks) {
      const sentences = block
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length > 0)

      if (sentences.length > 1) {
        units.push(...sentences)
      } else {
        units.push(block)
      }
    }

    return units
  },

  splitLongUnit (text, maxChunk) {
    const fragments = []
    let remaining = _.toString(text || '').trim()

    while (remaining.length > maxChunk) {
      let splitAt = remaining.lastIndexOf(' ', maxChunk)
      if (splitAt < Math.floor(maxChunk * 0.55)) {
        splitAt = maxChunk
      }

      fragments.push(remaining.slice(0, splitAt).trim())
      remaining = remaining.slice(splitAt).trim()
    }

    if (remaining.length > 0) {
      fragments.push(remaining)
    }

    return fragments
  },

  chunkText (input = '') {
    const text = _.trim(_.toString(input || ''))
    if (!text) {
      return []
    }

    const maxChunk = Math.max(200, _.toInteger(this.conf.maxChunkChars) || 1200)
    const overlap = Math.max(0, _.toInteger(this.conf.chunkOverlapChars) || 150)
    const rawUnits = this.splitIntoSemanticUnits(text)
    const units = _.flatMap(rawUnits, unit => unit.length > maxChunk ? this.splitLongUnit(unit, maxChunk) : [unit])
      .filter(unit => unit.length > 0)

    if (units.length < 1) {
      return []
    }

    const chunks = []
    let startIdx = 0

    while (startIdx < units.length) {
      const current = []
      let currentLength = 0
      let endIdx = startIdx

      while (endIdx < units.length) {
        const candidate = units[endIdx]
        const additionalLength = current.length > 0 ? candidate.length + 1 : candidate.length

        if (current.length > 0 && currentLength + additionalLength > maxChunk) {
          break
        }

        current.push(candidate)
        currentLength += additionalLength
        endIdx += 1
      }

      const chunk = current.join(' ').trim()
      if (chunk.length > 80) {
        chunks.push(chunk)
      }

      if (endIdx >= units.length) {
        break
      }

      let nextStart = endIdx
      let overlapLength = 0

      while (nextStart > startIdx && overlapLength < overlap) {
        nextStart -= 1
        overlapLength += units[nextStart].length + 1
      }

      startIdx = Math.max(nextStart, startIdx + 1)
    }

    return _.uniq(chunks)
  },

  buildSystemPrompt ({ answerMode } = {}) {
    const basePrompt = _.trim(_.toString(this.conf.systemPrompt || '')) || DEFAULT_SYSTEM_PROMPT
    const normalizedAnswerMode = this.normalizeAnswerMode(answerMode || this.getDefaultAnswerMode())
    const promptPreset = this.normalizePromptPreset(this.conf.promptPreset)
    const sections = [
      basePrompt,
      PROMPT_PRESET_INSTRUCTIONS[promptPreset],
      ANSWER_MODE_INSTRUCTIONS[normalizedAnswerMode]
    ]

    if (this.conf.strictCitationMode) {
      sections.push('Jede sachliche Kernaussage muss direkt durch die bereitgestellten Quellen gedeckt sein. Ziehe keine Schlussfolgerungen aus allgemeinem Weltwissen. Wenn der Nutzer nach einem exakten Wortlaut oder Zitat fragt, liefere nur kurze exakte Zitate aus den Quellen und kennzeichne sie mit dem passenden [Source N]-Verweis.')
    }

    return sections.filter(part => !_.isEmpty(_.trim(part))).join(' ')
  },

  getOpenAIChatRequestBody (model, systemPrompt, userPrompt) {
    return {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }
  },

  async listProviderModels ({ provider, baseUrl, apiKey } = {}) {
    const connection = this.getProviderConnectionConfig(provider, {
      baseUrl,
      apiKey
    })

    if (connection.provider === 'openai') {
      if (_.isEmpty(connection.apiKey)) {
        throw new Error('Zum Laden der OpenAI-Modelle wird ein API-Key benötigt.')
      }

      const resp = await fetch(`${connection.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
      }).then(r => r.json())

      const modelIds = _.uniq(_.sortBy((resp.data || [])
        .map(row => _.toString(row.id || ''))
        .filter(id => !_.isEmpty(id))))
      const embeddingModels = modelIds.filter(id => this.isEmbeddingLikeModelId(id))

      return {
        provider: connection.provider,
        chatModels: modelIds.filter(id => !this.isEmbeddingLikeModelId(id)),
        embeddingModels
      }
    }

    if (connection.provider === 'ollama') {
      const resp = await fetch(`${connection.baseUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
      }).then(r => r.json())

      const modelIds = _.uniq(_.sortBy((resp.models || [])
        .map(row => _.toString(row.name || row.model || ''))
        .filter(id => !_.isEmpty(id))))
      const embeddingModels = modelIds.filter(id => this.isEmbeddingLikeModelId(id))
      const chatModels = embeddingModels.length < modelIds.length ?
        modelIds.filter(id => !this.isEmbeddingLikeModelId(id)) :
        modelIds

      return {
        provider: connection.provider,
        chatModels,
        embeddingModels: embeddingModels.length > 0 ? embeddingModels : modelIds
      }
    }

    throw new Error(`Provider "${connection.provider}" is not supported for model discovery.`)
  },

  async testProviderConnection ({ provider, baseUrl, apiKey, chatModel, embeddingModel } = {}) {
    const connection = this.getProviderConnectionConfig(provider, {
      baseUrl,
      apiKey,
      chatModel,
      embeddingModel
    })

    const result = {
      provider: connection.provider,
      chatModel: connection.chatModel,
      embeddingModel: connection.embeddingModel,
      chatSucceeded: false,
      embeddingSucceeded: false,
      streamingSupported: false,
      streamingSucceeded: false,
      chatMessage: 'Kein Chat-Modell ausgewählt.',
      embeddingMessage: 'Kein Embedding-Modell ausgewählt.',
      streamingMessage: ''
    }

    const streamingCapability = this.getStreamingCapability(connection.provider)
    result.streamingSupported = !!streamingCapability.supported
    result.streamingMessage = streamingCapability.message

    if (connection.provider === 'openai' && _.isEmpty(connection.apiKey)) {
      throw new Error('Für den OpenAI-Verbindungstest wird ein API-Key benötigt.')
    }

    if (!_.isEmpty(connection.chatModel)) {
      try {
        if (connection.provider === 'openai') {
          await this.callOpenAICompatible('/chat/completions', this.getOpenAIChatRequestBody(
            connection.chatModel,
            'You are a connectivity test. Reply with OK only.',
            'Reply with OK.'
          ), {
            baseUrl: connection.baseUrl,
            apiKey: connection.apiKey
          })
        } else if (connection.provider === 'ollama') {
          await this.callOllama('/api/chat', {
            model: connection.chatModel,
            stream: false,
            messages: [
              { role: 'user', content: 'Reply with OK.' }
            ]
          }, {
            baseUrl: connection.baseUrl
          })
        }

        result.chatSucceeded = true
        result.chatMessage = `Chat-Modell "${connection.chatModel}" hat erfolgreich geantwortet.`
      } catch (err) {
        result.chatMessage = this.formatProviderError(err)
      }
    }

    if (!_.isEmpty(connection.embeddingModel)) {
      try {
        if (connection.provider === 'openai') {
          const resp = await this.callOpenAICompatible('/embeddings', {
            model: connection.embeddingModel,
            input: 'connectivity test'
          }, {
            baseUrl: connection.baseUrl,
            apiKey: connection.apiKey
          })

          const embedding = _.get(resp, 'data[0].embedding', [])
          if (!Array.isArray(embedding) || embedding.length < 1) {
            throw new Error('Embedding response is empty.')
          }
        } else if (connection.provider === 'ollama') {
          const resp = await this.callOllama('/api/embeddings', {
            model: connection.embeddingModel,
            prompt: 'connectivity test'
          }, {
            baseUrl: connection.baseUrl
          })

          const embedding = _.get(resp, 'embedding', [])
          if (!Array.isArray(embedding) || embedding.length < 1) {
            throw new Error('Embedding response is empty.')
          }
        }

        result.embeddingSucceeded = true
        result.embeddingMessage = `Embedding-Modell "${connection.embeddingModel}" hat erfolgreich geantwortet.`
      } catch (err) {
        result.embeddingMessage = this.formatProviderError(err)
      }
    }

    if (streamingCapability.supported && !_.isEmpty(connection.chatModel)) {
      try {
        let streamedAnswer = ''
        const streamControl = { cancel: () => {} }

        if (connection.provider === 'openai') {
          streamedAnswer = await this.streamOpenAICompatible('/chat/completions', this.getOpenAIChatRequestBody(
            connection.chatModel,
            'You are a connectivity test. Reply with OK only.',
            'Reply with OK.'
          ), {
            baseUrl: connection.baseUrl,
            apiKey: connection.apiKey,
            control: streamControl
          })
        } else if (connection.provider === 'ollama') {
          streamedAnswer = await this.streamOllamaChat({
            model: connection.chatModel,
            stream: true,
            messages: [
              { role: 'user', content: 'Reply with OK.' }
            ]
          }, {
            baseUrl: connection.baseUrl,
            control: streamControl
          })
        }

        if (!_.isEmpty(_.trim(streamedAnswer))) {
          result.streamingSucceeded = true
          result.streamingMessage = `Streaming mit "${connection.chatModel}" funktioniert.`
        } else {
          result.streamingMessage = 'Streaming wurde erreicht, lieferte aber keinen Inhalt.'
        }
      } catch (err) {
        result.streamingMessage = this.formatProviderError(err)
      }
    }

    return result
  },

  sanitizeAssistantAnswer (value) {
    let answer = _.toString(value || '')

    answer = answer.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    answer = answer.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    answer = answer.replace(/<think\b[^>]*>[\s\S]*$/i, '')
    answer = answer.replace(/<thinking\b[^>]*>[\s\S]*$/i, '')
    answer = answer.replace(/<\/think>|<\/thinking>/gi, '')
    answer = answer.replace(/\n{0,2}(?:#+\s*)?(?:Verwendete Quellen|Quellen|Used Sources|Sources)\s*:?\s*$/i, '')
    answer = answer.replace(/\r\n/g, '\n')
    answer = answer.replace(/\n{3,}/g, '\n\n')
    answer = answer.trim()

    return answer || 'Ich konnte keine belastbare Antwort aus den freigegebenen Quellen erzeugen.'
  },

  normalizeTranscriptMessages (messages = []) {
    return _.take(
      (messages || [])
        .filter(message => _.isObject(message))
        .map(message => ({
          role: _.toString(message.role || '').toLowerCase() === 'user' ? 'user' : 'assistant',
          content: _.trim(_.toString(message.content || '')),
          sources: _.take(
            (message.sources || [])
              .filter(source => _.isObject(source))
              .map(source => ({
                title: _.trim(_.toString(source.title || '')),
                locale: _.trim(_.toString(source.locale || '')),
                path: _.trim(_.toString(source.path || ''))
              }))
              .filter(source => !_.isEmpty(source.path)),
            10
          )
        }))
        .filter(message => !_.isEmpty(message.content)),
      30
    )
  },

  renderTranscriptText (messages = []) {
    return messages
      .map(message => {
        const title = message.role === 'user' ? 'Du' : 'Assistent'
        const sourceBlock = message.sources.length > 0 ?
          `\nQuellen:\n${message.sources.map(source => `- ${source.title || source.path} (${source.locale}/${source.path})`).join('\n')}` :
          ''

        return `${title}:\n${message.content}${sourceBlock}`
      })
      .join('\n\n')
      .trim()
  },

  renderTranscriptHtml (messages = []) {
    return messages
      .map(message => {
        const title = message.role === 'user' ? 'Du' : 'Assistent'
        const sourceList = message.sources.length > 0 ?
          `<div style="margin-top:10px;"><strong>Quellen</strong><ul style="margin:8px 0 0 18px; padding:0;">${message.sources.map(source => `<li>${_.escape(source.title || source.path)} (${_.escape(source.locale)}/${_.escape(source.path)})</li>`).join('')}</ul></div>` :
          ''

        return `<div style="margin:0 0 18px 0; padding:16px; border:1px solid #e5e7eb; border-radius:10px; background:${message.role === 'user' ? '#eff6ff' : '#fff7ed'};"><div style="font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:${message.role === 'user' ? '#1d4ed8' : '#c2410c'}; margin-bottom:8px;">${title}</div><div style="white-space:pre-wrap; line-height:1.6; color:#111827;">${_.escape(message.content)}</div>${sourceList}</div>`
      })
      .join('')
  },

  async emailTranscript ({ to, subject, messages, requestedBy } = {}) {
    const normalizedMessages = this.normalizeTranscriptMessages(messages)
    if (_.isEmpty(to) || normalizedMessages.length < 1) {
      throw new Error('Transcript email requires a recipient and at least one message.')
    }

    const transcriptText = this.renderTranscriptText(normalizedMessages)
    const transcriptHtml = this.renderTranscriptHtml(normalizedMessages)
    const generatedAt = new Date().toISOString()

    await WIKI.mail.send({
      template: 'rag-chat-transcript',
      to,
      subject: subject || 'Chat transcript',
      text: transcriptText,
      data: {
        title: 'AI Wiki Chat Transcript',
        preheadertext: 'Exported AI wiki chat transcript.',
        intro: `Requested by ${_.toString(_.get(requestedBy, 'name', 'Unknown User'))} on ${generatedAt}.`,
        transcriptHtml
      }
    })
  },

  async embedText (text) {
    let embedding = []
    const provider = _.toString(this.conf.embeddingProvider || 'openai')

    if (provider === 'openai') {
      const resp = await this.callOpenAICompatible('/embeddings', {
        model: this.conf.embeddingModel,
        input: text,
        dimensions: this.conf.embeddingDimensions
      }, {
        baseUrl: this.conf.openaiBaseUrl,
        apiKey: this.conf.openaiApiKey
      })
      embedding = _.get(resp, 'data[0].embedding', [])
    } else if (provider === 'mistral') {
      const resp = await this.callOpenAICompatible('/embeddings', {
        model: this.conf.mistralEmbeddingModel,
        input: text
      }, {
        baseUrl: this.conf.mistralBaseUrl,
        apiKey: this.conf.mistralApiKey
      })
      embedding = _.get(resp, 'data[0].embedding', [])
    } else if (provider === 'gemini') {
      const resp = await this.callGeminiEmbedding(text)
      embedding = _.get(resp, 'embedding.values', [])
    } else if (provider === 'ollama') {
      const resp = await this.callOllama('/api/embeddings', {
        model: this.conf.ollamaEmbeddingModel,
        prompt: text
      })
      embedding = _.get(resp, 'embedding', [])
    }

    if (!Array.isArray(embedding) || embedding.length < 1) {
      throw new Error(`Embedding response is empty for provider ${provider}.`)
    }

    return embedding
  },

  toVectorLiteral (embedding) {
    return `[${embedding.map(v => _.toNumber(v)).join(',')}]`
  },

  async search (query, { locale, path, pathMode = 'PREFIX', topK, user } = {}) {
    if (!this.enabled) {
      return []
    }

    if (!this.isUserAllowed(user)) {
      return []
    }

    const q = _.trim(query || '')
    if (!q) {
      return []
    }

    const expandedQuery = this.expandQueryWithAliases(q)

    const schemaState = await this.ensureSchema()
    if (!schemaState.ready) {
      return []
    }

    const queryEmbedding = await this.embedText(expandedQuery)
    this.assertEmbeddingDimensions(queryEmbedding, schemaState)
    const vectorLiteral = this.toVectorLiteral(queryEmbedding)

    const safeTopK = Math.max(1, _.toInteger(topK || this.conf.defaultTopK || 8))
    const candidateLimit = Math.min(
      Math.max(safeTopK * 4, safeTopK),
      _.toInteger(this.conf.maxCandidates || 60)
    )

    const whereClauses = []
    const whereParams = []

    if (locale) {
      whereClauses.push('"localeCode" = ?')
      whereParams.push(locale)
    }

    const pathClause = this.buildScopedPathClause('"path"', path, pathMode)
    if (pathClause) {
      whereClauses.push(pathClause.clause)
      whereParams.push(...pathClause.params)
    }

    const scopeClause = this.buildScopeClause('"path"')
    if (scopeClause) {
      whereClauses.push(scopeClause.clause)
      whereParams.push(...scopeClause.params)
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const rows = await WIKI.models.knex.raw(
      `SELECT
        "id", "pageId", "path", "localeCode", "title", "chunkText", "tags",
        (1 - ("embedding" <=> ?::vector)) AS "score"
      FROM "ragChunks"
      ${whereSQL}
      ORDER BY "embedding" <=> ?::vector
      LIMIT ?`,
      [
        vectorLiteral,
        ...whereParams,
        vectorLiteral,
        candidateLimit
      ]
    )

    const candidates = _.get(rows, 'rows', rows) || []
    const allowed = []

    for (const row of candidates) {
      const pageTags = (_.isString(row.tags) ? JSON.parse(row.tags) : row.tags || []).map(tag => ({ tag }))

      if (WIKI.auth.checkAccess(user, ['read:pages'], {
        path: row.path,
        locale: row.localeCode,
        tags: pageTags
      })) {
        allowed.push({
          id: row.id,
          pageId: row.pageId,
          path: row.path,
          locale: row.localeCode,
          title: row.title,
          chunk: row.chunkText,
          score: _.toNumber(row.score)
        })
      }
    }

    return this.rerankSearchCandidates(expandedQuery, allowed, {
      applyThreshold: _.isEmpty(path)
    }).slice(0, safeTopK)
  },

  async buildAnswerPayload (query, opts = {}) {
    if (!this.isUserAllowed(opts.user)) {
      return {
        immediateAnswer: 'Du hast keine Berechtigung, den Chatbot zu verwenden.',
        chunks: []
      }
    }

    const results = await this.search(query, opts)
    if (results.length < 1) {
      return {
        immediateAnswer: 'Ich habe keine passenden, freigegebenen Wiki-Inhalte gefunden.',
        chunks: []
      }
    }

    const topScore = _.toNumber(_.get(results, '[0].score', 0))
    if (topScore < this.getNoAnswerThreshold()) {
      return {
        immediateAnswer: 'Ich finde dazu in den freigegebenen Quellen nichts ausreichend Belastbares.',
        chunks: []
      }
    }

    const context = results.map((result, idx) => {
      return `# Source ${idx + 1}\n[${result.locale}] ${result.path}\nTitel: ${result.title}\n${result.chunk}`
    }).join('\n\n')

    const history = _.takeRight(
      (opts.history || [])
        .filter(message => _.isObject(message))
        .map(message => ({
          role: _.toString(message.role || '').toLowerCase(),
          content: _.trim(_.toString(message.content || ''))
        }))
        .filter(message => ['user', 'assistant'].includes(message.role) && message.content.length > 0),
      5
    )

    const historyBlock = history.length > 0 ? history.map((message, idx) => `[${idx + 1}] ${message.role}: ${message.content}`).join('\n') : ''

    return {
      immediateAnswer: '',
      chunks: results,
      systemPrompt: this.buildSystemPrompt({
        answerMode: opts.answerMode
      }),
      userPrompt: historyBlock ? `Konversationsverlauf (letzte ${history.length} Nachrichten):\n${historyBlock}\n\nAktuelle Frage:\n${query}\n\nQuellen:\n${context}` : `Frage:\n${query}\n\nQuellen:\n${context}`,
      chatProvider: _.toString(this.conf.chatProvider || 'openai')
    }
  },

  getMistralChatRequestBody (systemPrompt, userPrompt) {
    return {
      model: this.conf.mistralChatModel,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }
  },

  getOllamaChatRequestBody (model, systemPrompt, userPrompt, { stream = false } = {}) {
    return {
      model,
      stream,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }
  },

  normalizeStreamVisibleText (value) {
    return _.toString(value || '')
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<think\b[^>]*>[\s\S]*$/i, '')
      .replace(/<thinking\b[^>]*>[\s\S]*$/i, '')
      .replace(/<\s*\/?\s*thi(?:n(?:k(?:ing)?)?)?[^>]*$/i, '')
      .replace(/<\/think>|<\/thinking>/gi, '')
  },

  async emitVisibleStreamingDelta (rawText, state, onToken) {
    if (!_.isFunction(onToken)) {
      return
    }

    const visibleText = this.normalizeStreamVisibleText(rawText)
    if (visibleText.length <= state.emittedText.length) {
      return
    }

    const delta = visibleText.slice(state.emittedText.length)
    state.emittedText = visibleText

    if (!_.isEmpty(delta)) {
      await onToken(delta)
    }
  },

  parseStreamingErrorMessage (rawValue, fallbackMessage) {
    const text = _.trim(_.toString(rawValue || ''))
    if (!text) {
      return fallbackMessage
    }

    try {
      const parsed = JSON.parse(text)
      return this.formatProviderError(parsed) || fallbackMessage
    } catch (err) {
      return text
    }
  },

  async streamOpenAICompatible (endpoint, body, { baseUrl, apiKey, onToken, control } = {}) {
    const rootUrl = _.trimEnd(baseUrl || 'https://api.openai.com/v1', '/')

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), _.toInteger(this.conf.requestTimeoutMs) || 30000)

    let upstreamResp
    try {
      upstreamResp = await fetch(`${rootUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          ...body,
          stream: true
        }),
        signal: abortController.signal
      })
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
    clearTimeout(timeoutId)

    if (control) {
      control.cancel = () => {
        try {
          abortController.abort()
        } catch (err) {}
      }
    }

    if (upstreamResp.status >= 400) {
      let errorText = ''
      try {
        errorText = await upstreamResp.text()
      } catch (err) {}
      throw new Error(this.parseStreamingErrorMessage(errorText, `Streaming-Request fehlgeschlagen (${upstreamResp.status}).`))
    }

    return new Promise((resolve, reject) => {
      let rawText = ''
      let buffer = ''
      let settled = false
      let queue = Promise.resolve()
      const streamState = {
        emittedText: ''
      }

      const processBlock = (block) => {
        const lines = block.split(/\r?\n/)
        const dataLines = lines
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .filter(line => line.length > 0)

        if (dataLines.length < 1) {
          return
        }

        const payloadText = dataLines.join('\n')
        if (payloadText === '[DONE]') {
          return
        }

        let payload
        try {
          payload = JSON.parse(payloadText)
        } catch (err) {
          return
        }

        const contentDelta = _.get(payload, 'choices[0].delta.content', '')
        const delta = _.isString(contentDelta) ? contentDelta : _.compact(
          (_.isArray(contentDelta) ? contentDelta : [])
            .map(part => _.toString(_.get(part, 'text', '')))
        ).join('')

        if (_.isEmpty(delta)) {
          return
        }

        rawText += delta
        queue = queue.then(() => this.emitVisibleStreamingDelta(rawText, streamState, onToken))
      }

      const flushBuffer = () => {
        let separatorIndex = buffer.indexOf('\n\n')
        while (separatorIndex >= 0) {
          const block = buffer.slice(0, separatorIndex).trim()
          buffer = buffer.slice(separatorIndex + 2)
          if (block) {
            processBlock(block)
          }
          separatorIndex = buffer.indexOf('\n\n')
        }
      }

      const finish = (handler) => {
        if (settled) {
          return
        }
        settled = true
        queue
          .then(handler)
          .catch(reject)
      }

      const { Readable } = require('stream')
      const reader = Readable.fromWeb(upstreamResp.body)
      reader.setEncoding('utf8')

      reader.on('data', chunk => {
        buffer += _.toString(chunk || '').replace(/\r\n/g, '\n')
        flushBuffer()
      })
      reader.on('end', () => {
        flushBuffer()
        finish(() => resolve(rawText))
      })
      reader.on('error', err => {
        finish(() => reject(err))
      })
    })
  },

  async streamOllamaChat (body, { baseUrl, onToken, control } = {}) {
    const resolvedBaseUrl = _.trimEnd(baseUrl || this.conf.ollamaBaseUrl || 'http://localhost:11434', '/')

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), _.toInteger(this.conf.requestTimeoutMs) || 30000)

    let upstreamResp
    try {
      upstreamResp = await fetch(`${resolvedBaseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          stream: true
        }),
        signal: abortController.signal
      })
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
    clearTimeout(timeoutId)

    if (control) {
      control.cancel = () => {
        try {
          abortController.abort()
        } catch (err) {}
      }
    }

    if (upstreamResp.status >= 400) {
      let errorText = ''
      try {
        errorText = await upstreamResp.text()
      } catch (err) {}
      throw new Error(this.parseStreamingErrorMessage(errorText, `Streaming-Request fehlgeschlagen (${upstreamResp.status}).`))
    }

    return new Promise((resolve, reject) => {
      let rawText = ''
      let buffer = ''
      let settled = false
      let queue = Promise.resolve()
      const streamState = {
        emittedText: ''
      }

      const processLine = (line) => {
        const trimmed = _.trim(line)
        if (!trimmed) {
          return
        }

        let payload
        try {
          payload = JSON.parse(trimmed)
        } catch (err) {
          return
        }

        const delta = _.toString(_.get(payload, 'message.content', ''))
        if (!_.isEmpty(delta)) {
          rawText += delta
          queue = queue.then(() => this.emitVisibleStreamingDelta(rawText, streamState, onToken))
        }
      }

      const flushLines = (force = false) => {
        let separatorIndex = buffer.indexOf('\n')
        while (separatorIndex >= 0) {
          const line = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 1)
          processLine(line)
          separatorIndex = buffer.indexOf('\n')
        }

        if (force && _.trim(buffer)) {
          processLine(buffer)
          buffer = ''
        }
      }

      const finish = (handler) => {
        if (settled) {
          return
        }
        settled = true
        queue
          .then(handler)
          .catch(reject)
      }

      const { Readable } = require('stream')
      const reader = Readable.fromWeb(upstreamResp.body)
      reader.setEncoding('utf8')

      reader.on('data', chunk => {
        buffer += _.toString(chunk || '').replace(/\r\n/g, '\n')
        flushLines(false)
      })
      reader.on('end', () => {
        flushLines(true)
        finish(() => resolve(rawText))
      })
      reader.on('error', err => {
        finish(() => reject(err))
      })
    })
  },

  createAnswerStream (query, opts = {}, handlers = {}) {
    const control = {
      cancel: () => {}
    }

    control.promise = this.streamAnswer(query, opts, handlers, control)
    return control
  },

  async streamAnswer (query, opts = {}, handlers = {}, control = null) {
    const payload = await this.buildAnswerPayload(query, opts)
    if (payload.immediateAnswer) {
      const answer = this.sanitizeAssistantAnswer(payload.immediateAnswer)
      if (_.isFunction(handlers.onToken) && !_.isEmpty(answer)) {
        await handlers.onToken(answer)
      }
      if (_.isFunction(handlers.onComplete)) {
        await handlers.onComplete({
          answer,
          chunks: payload.chunks
        })
      }
      return {
        answer,
        chunks: payload.chunks
      }
    }

    const capability = this.getStreamingCapability(payload.chatProvider)
    if (!capability.supported) {
      throw new Error(capability.message)
    }

    let rawAnswer = ''

    if (payload.chatProvider === 'openai') {
      rawAnswer = await this.streamOpenAICompatible('/chat/completions', this.getOpenAIChatRequestBody(this.conf.chatModel, payload.systemPrompt, payload.userPrompt), {
        baseUrl: this.conf.openaiBaseUrl,
        apiKey: this.conf.openaiApiKey,
        onToken: handlers.onToken,
        control
      })
    } else if (payload.chatProvider === 'mistral') {
      rawAnswer = await this.streamOpenAICompatible('/chat/completions', this.getMistralChatRequestBody(payload.systemPrompt, payload.userPrompt), {
        baseUrl: this.conf.mistralBaseUrl,
        apiKey: this.conf.mistralApiKey,
        onToken: handlers.onToken,
        control
      })
    } else if (payload.chatProvider === 'ollama') {
      rawAnswer = await this.streamOllamaChat(this.getOllamaChatRequestBody(this.conf.ollamaChatModel, payload.systemPrompt, payload.userPrompt, {
        stream: true
      }), {
        baseUrl: this.conf.ollamaBaseUrl,
        onToken: handlers.onToken,
        control
      })
    }

    const answer = this.sanitizeAssistantAnswer(rawAnswer || 'Keine Antwort vom Modell erhalten.')

    if (_.isFunction(handlers.onComplete)) {
      await handlers.onComplete({
        answer,
        chunks: payload.chunks
      })
    }

    return {
      answer,
      chunks: payload.chunks
    }
  },

  async ask (query, opts = {}) {
    const payload = await this.buildAnswerPayload(query, opts)
    if (payload.immediateAnswer) {
      return {
        answer: this.sanitizeAssistantAnswer(payload.immediateAnswer),
        chunks: payload.chunks
      }
    }

    let answer = ''

    if (payload.chatProvider === 'openai') {
      const resp = await this.callOpenAICompatible('/chat/completions', this.getOpenAIChatRequestBody(this.conf.chatModel, payload.systemPrompt, payload.userPrompt), {
        baseUrl: this.conf.openaiBaseUrl,
        apiKey: this.conf.openaiApiKey
      })
      answer = _.get(resp, 'choices[0].message.content', '') || ''
    } else if (payload.chatProvider === 'mistral') {
      const resp = await this.callOpenAICompatible('/chat/completions', this.getMistralChatRequestBody(payload.systemPrompt, payload.userPrompt), {
        baseUrl: this.conf.mistralBaseUrl,
        apiKey: this.conf.mistralApiKey
      })
      answer = _.get(resp, 'choices[0].message.content', '') || ''
    } else if (payload.chatProvider === 'claude') {
      const resp = await this.callClaude(payload.userPrompt, payload.systemPrompt)
      answer = _.get(resp, 'content[0].text', '') || ''
    } else if (payload.chatProvider === 'gemini') {
      const resp = await this.callGeminiGenerate(payload.userPrompt, payload.systemPrompt)
      answer = _.get(resp, 'candidates[0].content.parts[0].text', '') || ''
    } else if (payload.chatProvider === 'ollama') {
      const resp = await this.callOllama('/api/chat', this.getOllamaChatRequestBody(this.conf.ollamaChatModel, payload.systemPrompt, payload.userPrompt), {
        baseUrl: this.conf.ollamaBaseUrl
      })
      answer = _.get(resp, 'message.content', '') || ''
    }

    if (!answer) {
      answer = 'Keine Antwort vom Modell erhalten.'
    }

    return {
      answer: this.sanitizeAssistantAnswer(answer),
      chunks: payload.chunks
    }
  },

  async callOpenAICompatible (endpoint, body, { baseUrl, apiKey }) {
    const rootUrl = _.trimEnd(baseUrl || 'https://api.openai.com/v1', '/')

    const resp = await fetch(`${rootUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
    })
    return resp.json()
  },

  async callClaude (userPrompt, systemPrompt) {
    const baseUrl = _.trimEnd(this.conf.claudeBaseUrl || 'https://api.anthropic.com/v1', '/')

    const resp = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.conf.claudeApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.conf.claudeModel,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      }),
      signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
    })
    return resp.json()
  },

  async callGeminiGenerate (userPrompt, systemPrompt) {
    const baseUrl = _.trimEnd(this.conf.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta', '/')
    const model = encodeURIComponent(this.conf.geminiChatModel || 'gemini-1.5-pro')

    const resp = await fetch(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(this.conf.geminiApiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1
        }
      }),
      signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
    })
    return resp.json()
  },

  async callGeminiEmbedding (text) {
    const baseUrl = _.trimEnd(this.conf.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta', '/')
    const model = encodeURIComponent(this.conf.geminiEmbeddingModel || 'text-embedding-004')

    const resp = await fetch(`${baseUrl}/models/${model}:embedContent?key=${encodeURIComponent(this.conf.geminiApiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }]
        }
      }),
      signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
    })
    return resp.json()
  },

  async callOllama (endpoint, body, { baseUrl } = {}) {
    const resolvedBaseUrl = _.trimEnd(baseUrl || this.conf.ollamaBaseUrl || 'http://localhost:11434', '/')

    const resp = await fetch(`${resolvedBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(_.toInteger(this.conf.requestTimeoutMs) || 30000)
    })
    return resp.json()
  }
}
