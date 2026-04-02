<template lang='pug'>
  .chatbot-widget(v-if='viewerLoaded && viewer.canUse')
    v-tooltip(:right='!rtl', :left='rtl')
      template(v-slot:activator='{ on }')
        v-btn.chatbot-main-btn(
          v-on='on'
          fab
          color='deep-orange darken-2'
          dark
          fixed
          :right='!rtl'
          :left='rtl'
          :style='mainButtonStyle'
          @click='dialog = true'
          :aria-label='`Wiki-Chatbot`'
        )
          img.chatbot-ai-icon(:src='aiIconUrl', alt='AI')
      span Wiki-Chatbot

    v-dialog(v-model='dialog', max-width='720', scrollable, content-class='chatbot-dialog')
      v-card.chatbot-card
        v-toolbar.chatbot-toolbar(flat, dark, color='deep-orange darken-2')
          img.chatbot-ai-icon.chatbot-ai-icon--toolbar(:src='aiIconUrl', alt='AI')
          span Wiki-Chatbot
          v-btn-toggle.chatbot-scope-toggle.mx-3(v-model='searchScope', dense, mandatory)
            v-btn(value='page', small, text, :disabled='!viewer.currentPathAllowed') Aktuelle Seite
            v-btn(v-if='hasSectionScope', value='section', small, text, :disabled='!viewer.currentPathAllowed') Bereich
            v-btn(value='wiki', small, text) Gesamtes Wiki
          v-spacer
          v-btn(icon, :disabled='transcriptMessages.length < 2', @click='openShareDialog')
            v-icon mdi-email-outline
          v-btn(icon, @click='dialog = false')
            v-icon mdi-close

        v-card-text.chatbot-body
          .caption.grey--text.mb-2
            | Ich beantworte nur auf Basis freigegebener Wiki-Inhalte. Quellen werden unten verlinkt.
          .caption.grey--text.mb-2(v-if='viewer.hasPathRestrictions')
            | Die Wiki-Suche ist auf die in den Admin-Einstellungen freigegebenen Bereiche begrenzt.
          .caption.orange--text.text--darken-3.mb-3(v-if='viewer.rebuildRecommended')
            | Der Index ist laut Metadaten nicht mehr auf dem neuesten Stand. Ergebnisse können veraltet sein, bis ein Rebuild läuft.
          .chatbot-mode-bar.mb-3
            .caption.grey--text.text--darken-1 Antwortmodus
            v-btn-toggle.chatbot-answer-toggle(v-model='answerMode', dense, mandatory)
              v-btn(value='short', small, text) Kurz
              v-btn(value='standard', small, text) Standard
              v-btn(value='detailed', small, text) Detail

          .chatbot-messages(ref='messages')
            template(v-for='(msg, idx) in messages', :key='idx')
              .chatbot-message(, :class='`is-${msg.role}`')
                .chatbot-message-title {{ msg.role === 'user' ? 'Du' : 'Assistent' }}
                .chatbot-message-text.chatbot-message-text--markdown(v-if='msg.role === `assistant`', v-html='renderAssistantMessage(msg.text)')
                .chatbot-message-text.chatbot-message-text--plain(v-else) {{ msg.text }}
                .chatbot-sources(v-if='msg.role === `assistant` && displaySources(msg).length > 0')
                  .caption.font-weight-bold.mb-1.mt-2 {{ sourceListLabel(msg) }}
                  v-list.chatbot-source-list(dense)
                    v-list-item(
                      v-for='(src, sIdx) in displaySources(msg)'

                      :href='sourceHref(src)'
                      target='_blank'
                    )
                      v-list-item-icon
                        v-icon(color='indigo', size='18') mdi-book-open-page-variant
                      v-list-item-content
                        v-list-item-title {{ src.title || src.path }}
                        v-list-item-subtitle /{{ src.locale }}/{{ src.path }}
                      v-list-item-action
                        v-btn(icon, small, color='indigo', @click.stop='openSourcePreview(src)')
                          v-icon(size='18') mdi-text-box-search-outline
                      v-list-item-action
                        v-chip(x-small, outlined, color='indigo')
                          v-icon(left, x-small) {{ sourceIcon(src.idx) }}
                          | Quelle {{ src.idx }}

            .chatbot-message.is-assistant(v-if='loading && !streamingResponseActive')
              .chatbot-message-title Assistent
              .chatbot-message-text.chatbot-message-text--plain
                v-progress-circular.mr-2(indeterminate, size='16', width='2', color='deep-orange darken-2')
                | Suche in „{{ scopeLabel }}“...

        v-divider

        v-card-actions.chatbot-actions
          v-text-field(
            v-model='question'
            label='Frage an das Wiki...'
            hide-details
            outlined
            dense
            @keydown.enter='ask'
          )
          v-btn.ml-2(color='deep-orange darken-2', dark, depressed, :loading='loading', @click='ask')
            v-icon(left) mdi-send
            span Fragen

    v-dialog(v-model='sourcePreviewDialog', max-width='760')
      v-card
        v-toolbar(flat, color='indigo', dark, dense)
          v-icon(left) mdi-text-box-search-outline
          span Quellenvorschau
          v-spacer
          v-btn(icon, @click='sourcePreviewDialog = false')
            v-icon mdi-close
        v-card-text(v-if='sourcePreview')
          .subtitle-1.font-weight-bold {{ sourcePreview.title || sourcePreview.path }}
          .caption.grey--text.mb-3 /{{ sourcePreview.locale }}/{{ sourcePreview.path }}
          .chatbot-source-preview-text {{ sourcePreview.chunk }}
        v-card-actions
          v-spacer
          v-btn(text, color='indigo', :href='sourcePreview ? sourceHref(sourcePreview) : `#`', target='_blank')
            v-icon(left) mdi-open-in-new
            span Seite öffnen

    v-dialog(v-model='shareDialog', max-width='560')
      v-card
        v-toolbar(flat, color='deep-orange darken-2', dark, dense)
          v-icon(left) mdi-email-outline
          span Chat per E-Mail senden
          v-spacer
          v-btn(icon, @click='shareDialog = false')
            v-icon mdi-close
        v-card-text
          v-text-field(
            v-model='shareEmail'
            label='Empfänger'
            type='email'
            outlined
            prepend-icon='mdi-email'
          )
          v-text-field(
            v-model='shareSubject'
            label='Betreff'
            outlined
            prepend-icon='mdi-format-title'
          )
          .caption.grey--text
            | Es wird der aktuelle sichtbare Chatverlauf inklusive sichtbarer Quellenangaben verschickt.
        v-card-actions
          v-spacer
          v-btn(text, @click='shareDialog = false') Abbrechen
          v-btn(color='deep-orange darken-2', dark, depressed, :loading='sendingTranscript', @click='sendTranscriptByEmail')
            v-icon(left) mdi-send
            span Senden
</template>

<script>
import _ from 'lodash'
import gql from 'graphql-tag'
import MarkdownIt from 'markdown-it'
import Cookies from 'js-cookie'

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typography: true
})
const AI_ICON_URL = '/_assets/img/ai-assistant.png'

export default {
  props: {
    locale: {
      type: String,
      default: 'en'
    },
    path: {
      type: String,
      default: 'home'
    },
    rtl: {
      type: Boolean,
      default: false
    },
    bottomOffset: {
      type: Number,
      default: 24
    }
  },
  data () {
    return {
      dialog: false,
      loading: false,
      streamingResponseActive: false,
      sendingTranscript: false,
      aiIconUrl: AI_ICON_URL,
      question: '',
      searchScope: 'page',
      answerMode: 'short',
      messages: [],
      shareDialog: false,
      shareEmail: '',
      shareSubject: 'Wiki-Chatverlauf',
      sourcePreviewDialog: false,
      sourcePreview: null,
      streamAbortController: null,
      viewerLoaded: false,
      viewer: {
        canUse: false,
        runtimeEnabled: false,
        streamingSupported: false,
        streamingEnabled: false,
        streamingSupportMessage: '',
        defaultAnswerMode: 'short',
        schemaReady: false,
        currentPathAllowed: true,
        hasPathRestrictions: false,
        rebuildRecommended: false,
        statusMessage: ''
      }
    }
  },
  computed: {
    userEmail: get('user/email'),
    mainButtonStyle () {
      return `bottom: ${this.bottomOffset}px;`
    },
    normalizedPath () {
      return _.trim(_.toString(this.path || ''), '/')
    },
    sectionScopePath () {
      if (!this.normalizedPath || this.normalizedPath === 'home' || this.normalizedPath.indexOf('/') < 0) {
        return ''
      }

      return this.normalizedPath.split('/').slice(0, -1).join('/')
    },
    hasSectionScope () {
      return !_.isEmpty(this.sectionScopePath) && this.sectionScopePath !== this.normalizedPath
    },
    scopeLabel () {
      if (this.searchScope === 'page') {
        return 'Aktuelle Seite'
      }
      if (this.searchScope === 'section') {
        return this.sectionScopePath ? `Bereich /${this.sectionScopePath}` : 'Bereich'
      }
      return 'Gesamtes Wiki'
    },
    transcriptMessages () {
      return this.messages.filter(msg => ['user', 'assistant'].includes(msg.role) && _.trim(_.toString(msg.text || '')).length > 0)
    },
    canStreamResponses () {
      return !!this.viewer.streamingEnabled &&
        typeof window !== 'undefined' &&
        typeof window.fetch === 'function' &&
        typeof window.TextDecoder !== 'undefined'
    }
  },
  watch: {
    async dialog (val) {
      if (val) {
        await this.ensureViewerState()
        if (!this.viewer.canUse) {
          this.dialog = false
          return
        }
        if (!this.viewer.currentPathAllowed) {
          this.searchScope = 'wiki'
        }
        this.answerMode = this.viewer.defaultAnswerMode || this.answerMode
        if (this.messages.length < 1) {
          this.messages.push({
            role: 'assistant',
            text: 'Hallo! Frag mich etwas zu dieser Seite, zum aktuellen Bereich oder zum gesamten freigegebenen Wiki.',
            sources: []
          })
        }
      } else {
        this.abortActiveStream()
      }
      this.$nextTick(this.scrollToBottom)
    },
    messages () {
      this.$nextTick(this.scrollToBottom)
    }
  },
  created () {
    this.ensureViewerState()
  },
  beforeUnmount () {
    this.abortActiveStream()
  },
  methods: {
    async ensureViewerState () {
      try {
        const resp = await this.$apollo.query({
          query: gql`
            query ($path: String) {
              rag {
                viewerState(path: $path) {
                  canUse
                  runtimeEnabled
                  streamingSupported
                  streamingEnabled
                  streamingSupportMessage
                  defaultAnswerMode
                  schemaReady
                  currentPathAllowed
                  hasPathRestrictions
                  rebuildRecommended
                  statusMessage
                }
              }
            }
          `,
          variables: {
            path: this.normalizedPath || null
          },
          fetchPolicy: 'network-only'
        })

        this.viewer = {
          ...this.viewer,
          ..._.get(resp, 'data.rag.viewerState', {})
        }
      } catch (err) {
        this.viewer = {
          ...this.viewer,
          canUse: false,
          statusMessage: _.get(err, 'message', 'Chatbot nicht verfügbar.')
        }
      }

      this.viewerLoaded = true
    },
    sourceHref (source) {
      return `/${source.locale}/${source.path}`
    },
    openSourcePreview (source) {
      this.sourcePreview = source
      this.sourcePreviewDialog = true
    },
    openShareDialog () {
      this.shareEmail = _.trim(_.toString(this.userEmail || this.shareEmail || ''))
      this.shareSubject = 'Wiki-Chatverlauf'
      this.shareDialog = true
    },
    sourceIcon (idx) {
      const safeIdx = Math.max(1, _.toInteger(idx) || 1)
      return safeIdx <= 10 ? `mdi-numeric-${safeIdx}-circle-outline` : 'mdi-book-open-page-variant'
    },
    scrollToBottom () {
      if (!this.$refs.messages) {
        return
      }
      this.$refs.messages.scrollTop = this.$refs.messages.scrollHeight
    },
    abortActiveStream () {
      if (this.streamAbortController) {
        try {
          this.streamAbortController.abort()
        } catch (err) {}
      }
      this.streamAbortController = null
      this.streamingResponseActive = false
    },
    buildSourcesFromChunks (chunks) {
      return _.uniqBy((chunks || []).map((chunk, idx) => ({
        idx: idx + 1,
        path: chunk.path,
        locale: chunk.locale,
        title: chunk.title,
        chunk: chunk.chunk,
        score: chunk.score
      })), chunk => `${chunk.locale}:${chunk.path}`)
    },
    async parseStreamFailureResponse (resp) {
      const rawText = await resp.text()

      try {
        const parsed = JSON.parse(rawText)
        return _.toString(parsed.message || parsed.error || rawText || `Streaming fehlgeschlagen (${resp.status}).`)
      } catch (err) {
        return _.toString(rawText || `Streaming fehlgeschlagen (${resp.status}).`)
      }
    },
    async processStreamEventBlock (block, handlers = {}) {
      let eventName = 'message'
      const dataLines = []

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          eventName = _.trim(line.slice(6))
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim())
        }
      }

      if (dataLines.length < 1) {
        return
      }

      let payload = {}
      try {
        payload = JSON.parse(dataLines.join('\n'))
      } catch (err) {
        payload = {
          message: dataLines.join('\n')
        }
      }

      if (eventName === 'token' && _.isFunction(handlers.onToken)) {
        await handlers.onToken(payload)
      } else if (eventName === 'done' && _.isFunction(handlers.onDone)) {
        await handlers.onDone(payload)
      } else if (eventName === 'error' && _.isFunction(handlers.onError)) {
        await handlers.onError(payload)
      }
    },
    async consumeStreamResponse (response, handlers = {}) {
      if (!response.body || !response.body.getReader) {
        throw new Error('Streaming wird vom Browser nicht unterstützt.')
      }

      const reader = response.body.getReader()
      const decoder = new window.TextDecoder('utf-8')
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')

        let separatorIndex = buffer.indexOf('\n\n')
        while (separatorIndex >= 0) {
          const block = buffer.slice(0, separatorIndex).trim()
          buffer = buffer.slice(separatorIndex + 2)
          if (block) {
            await this.processStreamEventBlock(block, handlers)
          }
          separatorIndex = buffer.indexOf('\n\n')
        }

        if (done) {
          const remainingBlock = buffer.trim()
          if (remainingBlock) {
            await this.processStreamEventBlock(remainingBlock, handlers)
          }
          break
        }
      }
    },
    async askNonStreaming ({ q, scope, historyPayload, targetMessage }) {
      const resp = await this.$apollo.query({
        query: gql`
          query ($query: String!, $locale: String, $path: String, $pathMode: RagPathMode, $history: [RagHistoryMessageInput!], $answerMode: String) {
            rag {
              ask(query: $query, locale: $locale, path: $path, pathMode: $pathMode, topK: 6, history: $history, answerMode: $answerMode) {
                answer
                chunks {
                  pageId
                  path
                  locale
                  title
                  chunk
                  score
                }
              }
            }
          }
        `,
        variables: {
          query: q,
          locale: scope.locale,
          path: scope.path,
          pathMode: scope.pathMode,
          history: historyPayload,
          answerMode: this.answerMode
        },
        fetchPolicy: 'network-only'
      })

      targetMessage.text = _.get(resp, 'data.rag.ask.answer', 'Keine Antwort erhalten.')
      targetMessage.sources = this.buildSourcesFromChunks(_.get(resp, 'data.rag.ask.chunks', []))
    },
    async askStreaming ({ q, scope, historyPayload, targetMessage }) {
      const controller = typeof window.AbortController !== 'undefined' ? new window.AbortController() : null
      this.streamAbortController = controller
      this.streamingResponseActive = true

      const resp = await window.fetch('/rag/stream', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          query: q,
          locale: scope.locale,
          path: scope.path,
          pathMode: scope.pathMode,
          history: historyPayload,
          answerMode: this.answerMode,
          topK: 6
        }),
        signal: controller ? controller.signal : undefined
      })

      const newJwt = resp.headers.get('new-jwt')
      if (newJwt) {
        Cookies.set('jwt', newJwt, { expires: 365, secure: window.location.protocol === 'https:' })
      }

      if (!resp.ok) {
        throw new Error(await this.parseStreamFailureResponse(resp))
      }

      let completed = false

      await this.consumeStreamResponse(resp, {
        onToken: async (payload) => {
          targetMessage.text += _.toString(payload.delta || '')
        },
        onDone: async (payload) => {
          completed = true
          targetMessage.text = _.toString(payload.answer || targetMessage.text || 'Keine Antwort erhalten.')
          targetMessage.sources = this.buildSourcesFromChunks(payload.chunks || [])
        },
        onError: async (payload) => {
          throw new Error(_.toString(payload.message || 'Streaming ist fehlgeschlagen.'))
        }
      })

      if (!completed && _.isEmpty(_.trim(targetMessage.text || ''))) {
        throw new Error('Streaming wurde beendet, ohne eine Antwort zu liefern.')
      }
    },
    resolveScope () {
      if (this.searchScope === 'page') {
        return {
          locale: this.locale,
          path: this.normalizedPath,
          pathMode: 'EXACT'
        }
      }

      if (this.searchScope === 'section' && this.hasSectionScope) {
        return {
          locale: this.locale,
          path: this.sectionScopePath,
          pathMode: 'PREFIX'
        }
      }

      return {
        locale: null,
        path: null,
        pathMode: 'PREFIX'
      }
    },
    async ask () {
      const q = _.trim(this.question)
      if (!q || this.loading) {
        return
      }

      await this.ensureViewerState()
      if (!this.viewer.canUse) {
        this.messages.push({
          role: 'assistant',
          text: this.viewer.statusMessage || 'Der Chatbot ist aktuell nicht verfügbar.',
          sources: []
        })
        return
      }

      const historyPayload = this.messages
        .filter(msg => ['user', 'assistant'].includes(msg.role))
        .map(msg => ({
          role: msg.role,
          content: _.trim(_.toString(msg.text || ''))
        }))
        .filter(msg => msg.content.length > 0 && !msg.content.startsWith('Hallo! Frag mich etwas'))
        .slice(-5)

      this.messages.push({
        role: 'user',
        text: q,
        sources: []
      })
      const targetMessage = {
        role: 'assistant',
        text: '',
        sources: []
      }
      this.messages.push(targetMessage)
      this.question = ''
      this.loading = true
      this.streamingResponseActive = false

      try {
        const scope = this.resolveScope()
        if (this.canStreamResponses) {
          try {
            await this.askStreaming({
              q,
              scope,
              historyPayload,
              targetMessage
            })
          } catch (err) {
            const wasAborted = _.get(err, 'name', '') === 'AbortError'
            const noPartialText = _.isEmpty(_.trim(targetMessage.text || ''))
            this.abortActiveStream()

            if (wasAborted) {
              if (noPartialText) {
                this.messages = this.messages.filter(msg => msg !== targetMessage)
              }
              return
            }

            if (noPartialText) {
              await this.askNonStreaming({
                q,
                scope,
                historyPayload,
                targetMessage
              })
            } else {
              targetMessage.text = `${_.trim(targetMessage.text)}\n\nHinweis: Streaming wurde unterbrochen.`
              targetMessage.sources = []
            }
          }
        } else {
          await this.askNonStreaming({
            q,
            scope,
            historyPayload,
            targetMessage
          })
        }
      } catch (err) {
        targetMessage.text = _.get(err, 'message', 'Fehler beim Abruf der Antwort.')
        targetMessage.sources = []
      } finally {
        this.abortActiveStream()
        this.loading = false
      }
    },
    normalizeAssistantText (text) {
      return _.toString(text || '')
        .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think\b[^>]*>[\s\S]*$/i, '')
        .replace(/<thinking\b[^>]*>[\s\S]*$/i, '')
        .replace(/<\/think>|<\/thinking>/gi, '')
        .replace(/(?:\n|^)\s*Quell(?:e|en)\s+\d+(?:\s*,\s*\d+)*(?:\s*\.)?\s*$/i, '')
        .replace(/\n{0,2}(?:#+\s*)?(?:Verwendete Quellen|Quellen|Used Sources|Sources)\s*:?\s*$/i, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    },
    renderAssistantMessage (text) {
      const normalized = this.normalizeAssistantText(text)
      const refs = this.extractSourceRefs(normalized)
      const collapseSingleSourceRefs = refs.length === 1
      const markdownText = collapseSingleSourceRefs ?
        normalized.replace(/\s*\[Source\s+\d+\]/gi, '').trim() :
        normalized

      const html = md.render(markdownText)
      const rendered = html.replace(/\[Source\s+(\d+)\]/gi, (match, rawIdx) => {
        const idx = _.toInteger(rawIdx)
        if (idx < 1) {
          return match
        }

        return `<span class="chatbot-source-ref" data-source="${idx}"><i aria-hidden="true" class="mdi ${this.sourceIcon(idx)}"></i><span>Quelle ${idx}</span></span>`
      })

      if (collapseSingleSourceRefs && refs[0] > 0) {
        return `${rendered}<div class="chatbot-source-ref-row"><span class="chatbot-source-ref" data-source="${refs[0]}"><i aria-hidden="true" class="mdi ${this.sourceIcon(refs[0])}"></i><span>Quelle ${refs[0]}</span></span></div>`
      }

      return rendered
    },
    displaySources (msg) {
      const refs = this.extractSourceRefs(this.normalizeAssistantText(msg.text))
      if (refs.length < 1) {
        if ((msg.sources || []).length === 1) {
          return msg.sources
        }
        return []
      }
      return (msg.sources || []).filter(src => refs.includes(src.idx))
    },
    sourceListLabel (msg) {
      return this.displaySources(msg).length === 1 ? 'Quelle' : 'Verwendete Quellen'
    },
    extractSourceRefs (text) {
      const matches = String(text || '').match(/\[Source\s+(\d+)\]/gi) || []
      return _.uniq(matches.map(match => _.toInteger((match.match(/(\d+)/) || [])[0])).filter(v => v > 0))
    },
    async sendTranscriptByEmail () {
      if (this.sendingTranscript) {
        return
      }

      const recipient = _.trim(_.toString(this.shareEmail || ''))
      if (!recipient) {
        this.$store.commit('showNotification', {
          message: 'Bitte gib eine Empfängeradresse an.',
          style: 'warning',
          icon: 'alert'
        })
        return
      }

      this.sendingTranscript = true

      try {
        const resp = await this.$apollo.mutate({
          mutation: gql`
            mutation ($input: RagTranscriptEmailInput!) {
              rag {
                emailTranscript(input: $input) {
                  responseResult {
                    succeeded
                    message
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              to: recipient,
              subject: _.trim(_.toString(this.shareSubject || '')) || 'Wiki-Chatverlauf',
              messages: this.transcriptMessages.map(message => ({
                role: message.role,
                content: message.role === 'assistant' ? this.normalizeAssistantText(message.text) : _.trim(_.toString(message.text || '')),
                sources: this.displaySources(message).map(source => ({
                  title: source.title,
                  locale: source.locale,
                  path: source.path
                }))
              }))
            }
          }
        })

        if (!_.get(resp, 'data.rag.emailTranscript.responseResult.succeeded', false)) {
          throw new Error(_.get(resp, 'data.rag.emailTranscript.responseResult.message', 'E-Mail konnte nicht versendet werden.'))
        }

        this.$store.commit('showNotification', {
          message: 'Chatverlauf per E-Mail versendet.',
          style: 'success',
          icon: 'check'
        })
        this.shareDialog = false
      } catch (err) {
        this.$store.commit('pushGraphError', err)
      }

      this.sendingTranscript = false
    }
  }
}
</script>

<style lang='scss'>
.chatbot-dialog {
  align-items: stretch !important;
  justify-content: flex-end !important;
  margin: 0 !important;

  .v-dialog {
    margin: 0 !important;
    width: min(720px, 100vw);
    max-width: min(720px, 100vw);
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    overflow: hidden;
  }
}

.chatbot-widget {
  .chatbot-main-btn {
    z-index: 14;
  }
}

.chatbot-ai-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  filter: brightness(0) invert(1);

  &--toolbar {
    margin-right: 12px;
  }
}

.chatbot-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chatbot-toolbar {
  flex: 0 0 auto;
}

.chatbot-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-bottom: 12px;
}

.chatbot-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.chatbot-actions {
  flex: 0 0 auto;
  align-items: flex-end;

  .v-text-field {
    flex: 1 1 auto;
  }
}

.chatbot-message {
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;

  &-title {
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 4px;
    letter-spacing: .05em;
  }

  &-text {
    line-height: 1.5;
  }

  &.is-user {
    background: #e3f2fd;

    .chatbot-message-title {
      color: #0d47a1;
    }
  }

  &.is-assistant {
    background: #fff3e0;

    .chatbot-message-title {
      color: #bf360c;
    }
  }
}

.chatbot-sources {
  margin-top: 8px;
}

.chatbot-source-list {
  border: 1px solid #d1d9ff;
  border-radius: 8px;
  background: #f8f9ff;
}

.chatbot-mode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chatbot-scope-toggle {
  background: rgba(255, 255, 255, .18);
  border-radius: 6px;

  .v-btn {
    min-width: 0;
    color: #fff;
    text-transform: none;
    letter-spacing: 0;
  }

  .v-btn--active {
    background: rgba(255, 255, 255, .26);
  }
}

.chatbot-answer-toggle {
  background: #fff3e0;
  border-radius: 6px;

  .v-btn {
    min-width: 0;
    color: #bf360c;
    text-transform: none;
    letter-spacing: 0;
  }

  .v-btn--active {
    background: #ffe0b2;
  }
}

.chatbot-message-text {
  &--plain {
    white-space: pre-wrap;
  }

  &--markdown {
    white-space: normal;
  }

  :first-child {
    margin-top: 0;
  }

  :last-child {
    margin-bottom: 0;
  }

  &--markdown p {
    padding-top: 0 !important;
    margin: 0 0 8px !important;
  }

  &--markdown > ul,
  &--markdown > ol,
  &--markdown ul,
  &--markdown ol {
    padding-top: 0 !important;
    margin: 0 0 8px 18px !important;
  }

  &--markdown li {
    margin: 0 !important;
  }

  &--markdown li + li {
    margin-top: 4px !important;
  }

  &--markdown li > p {
    display: inline !important;
    padding-top: 0 !important;
    margin: 0 !important;
  }

  &--markdown h1,
  &--markdown h2,
  &--markdown h3,
  &--markdown h4 {
    margin: 12px 0 8px;
    line-height: 1.25;
  }

  &--markdown code {
    background: rgba(0, 0, 0, .08);
    padding: 1px 4px;
    border-radius: 4px;
    font-size: 12px;
  }

  &--markdown strong {
    font-weight: 700;
    color: #7f2d0a;
  }
}

.chatbot-source-ref {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 0 2px;
  border-radius: 999px;
  border: 1px solid #fdba74;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  vertical-align: middle;
  white-space: nowrap;

  .mdi {
    font-size: 14px;
    color: #d97706;
  }
}

.chatbot-source-ref-row {
  margin-top: 8px;
}

.chatbot-source-preview-text {
  white-space: pre-wrap;
  line-height: 1.65;
  font-size: 14px;
  color: #374151;
  background: #f8fafc;
  border: 1px solid #dbeafe;
  border-radius: 10px;
  padding: 14px;
}

@media (max-width: 720px) {
  .chatbot-toolbar {
    .v-toolbar__content {
      flex-wrap: wrap;
      height: auto !important;
      row-gap: 8px;
      padding-top: 8px;
      padding-bottom: 8px;
    }
  }

  .chatbot-scope-toggle {
    order: 3;
    width: 100%;
    margin: 0 !important;
  }

  .chatbot-mode-bar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
