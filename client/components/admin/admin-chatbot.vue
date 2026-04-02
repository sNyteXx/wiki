<template lang='pug'>
  v-container(fluid, grid-list-lg)
    v-layout(row, wrap)
      v-flex(xs12)
        .admin-header
          img.animated.fadeInUp(src='/_assets/img/ai-assistant.png', alt='Chatbot', style='width: 80px;')
          .admin-header-title
            .headline.primary--text.animated.fadeInLeft Chatbot (RAG)
            .subtitle-1.grey--text.animated.fadeInLeft.wait-p2s Verwalte Modelle, Antwortverhalten, Pfadregeln und Indexierung für den Wiki-Chatbot.
          v-spacer
          v-btn.mr-3.animated.fadeInDown.wait-p2s(icon, outlined, color='grey', @click='refresh')
            v-icon mdi-refresh
          v-btn.mr-3.animated.fadeInDown.wait-p1s(
            color='black'
            dark
            depressed
            :loading='isRebuildRunning'
            :disabled='!status.runtimeEnabled || isRebuildRunning'
            @click='rebuild'
          )
            v-icon(left) mdi-cached
            span {{ rebuildButtonText }}
          v-btn.animated.fadeInDown(color='success', depressed, large, @click='save')
            v-icon(left) mdi-check
            span {{ $t('common:actions.apply') }}

      v-flex(lg8, xs12)
        v-card.animated.fadeInUp
          v-toolbar(flat, color='primary', dark, dense)
            .subtitle-1 Grundeinstellungen
          v-card-text
            v-alert.mb-4(outlined, :color='statusColor', :icon='statusIcon', :value='true')
              .body-2 {{ status.statusMessage }}
              .caption.mt-2(v-if='!status.schemaReady')
                | Beim normalen Deploy oder Start wird kein RAG-Schema angelegt. Das passiert erst bewusst über "{{ rebuildButtonText }}".
              .caption.mt-2(v-if='status.rebuildRecommended')
                | Der gespeicherte Index passt nicht mehr zu den aktuellen Embedding-, Chunking- oder Pfad-Einstellungen.

            v-progress-linear.mb-4(
              v-if='isRebuildRunning'
              color='deep-orange darken-2'
              height='12'
              rounded
              :value='status.job.progress'
            )

            .caption.mb-4.grey--text(v-if='status.metadata')
              | Indexierte Seiten: {{ status.metadata.indexedPages }} | Indexierte Chunks: {{ status.metadata.indexedChunks }} | Letzter Build: {{ status.metadata.lastBuildCompletedAt || 'nie' }}

            v-switch(
              v-model='conf.enabled'
              inset
              color='primary'
              label='Chatbot-RAG aktivieren'
              persistent-hint
              hint='Schaltet den RAG-Chatbot für Seitenchat und AI-Suche grundsätzlich ein oder aus.'
            )

            v-switch(
              v-model='conf.autoBootstrap'
              inset
              color='primary'
              label='Index bei leerem Storage automatisch starten'
              persistent-hint
              hint='Startet beim Serverstart automatisch einen ersten Rebuild, wenn das RAG-Storage schon existiert, aber noch leer ist.'
            )

            v-switch(
              v-model='conf.enableSearchButton'
              inset
              color='primary'
              label='AI-Suchbutton in Suche anzeigen'
              persistent-hint
              hint='Zeigt in der globalen Suche einen zusätzlichen AI-Button für berechtigte Nutzer an.'
            )

            v-layout(row, wrap)
              v-flex(lg6, xs12)
                v-select(
                  outlined
                  prepend-icon='mdi-head-cog-outline'
                  label='Chat-Anbieter'
                  v-model='conf.chatProvider'
                  :items='chatProviderItems'
                  persistent-hint
                  hint='Welches Modell die finale Antwort formuliert.'
                )
              v-flex(lg6, xs12)
                v-select(
                  outlined
                  prepend-icon='mdi-vector-line'
                  label='Embedding-Anbieter'
                  v-model='conf.embeddingProvider'
                  :items='embeddingProviderItems'
                  persistent-hint
                  hint='Welcher Anbieter Inhalte und Fragen als Vektoren für die Suche umwandelt.'
                )

            v-layout(row, wrap)
              v-flex(lg4, xs12)
                v-text-field(
                  outlined
                  prepend-icon='mdi-content-cut'
                  type='number'
                  min='200'
                  step='1'
                  label='Max. Zeichen pro Chunk'
                  v-model.number='conf.maxChunkChars'
                  persistent-hint
                  hint='Größe eines einzelnen Textabschnitts im Index.'
                )
              v-flex(lg4, xs12)
                v-text-field(
                  outlined
                  prepend-icon='mdi-call-merge'
                  type='number'
                  min='0'
                  step='1'
                  label='Chunk-Überlappung'
                  v-model.number='conf.chunkOverlapChars'
                  persistent-hint
                  hint='Wie viel Text sich benachbarte Chunks teilen.'
                )
              v-flex(lg4, xs12)
                v-text-field(
                  outlined
                  prepend-icon='mdi-timer-outline'
                  type='number'
                  min='1000'
                  step='1000'
                  label='Timeout (ms)'
                  v-model.number='conf.requestTimeoutMs'
                  persistent-hint
                  hint='Maximale Wartezeit für API-Anfragen an Modelle.'
                )

            v-layout(row, wrap)
              v-flex(lg6, xs12)
                v-text-field(
                  outlined
                  prepend-icon='mdi-filter-multiple'
                  type='number'
                  min='5'
                  step='1'
                  label='Max. Kandidaten'
                  v-model.number='conf.maxCandidates'
                  persistent-hint
                  hint='Wie viele Treffer zuerst geholt werden, bevor neu sortiert wird.'
                )
              v-flex(lg6, xs12)
                v-text-field(
                  outlined
                  prepend-icon='mdi-format-list-numbered'
                  type='number'
                  min='1'
                  step='1'
                  label='Standard Top-K'
                  v-model.number='conf.defaultTopK'
                  persistent-hint
                  hint='Wie viele finale Treffer der Chat standardmäßig als Kontext nutzt.'
                )

            v-divider.my-2

            .subtitle-2.mt-4.mb-3 Antwortverhalten

            v-layout(row, wrap)
              v-flex(lg4, xs12)
                v-select(
                  outlined
                  prepend-icon='mdi-format-list-bulleted-square'
                  label='Standard-Antwortmodus'
                  v-model='conf.defaultAnswerMode'
                  :items='answerModeItems'
                  persistent-hint
                  hint='Legt fest, ob der Chat standardmäßig kurz, normal oder ausführlicher antwortet.'
                )
              v-flex(lg4, xs12)
                v-select(
                  outlined
                  prepend-icon='mdi-tune-variant'
                  label='Prompt-Preset'
                  v-model='conf.promptPreset'
                  :items='promptPresetItems'
                  persistent-hint
                  hint='Vorgabe für den Antwortstil, z. B. knapp, stichpunktartig oder support-orientiert.'
                )
              v-flex(lg4, xs12)
                v-text-field(
                  outlined
                  prepend-icon='mdi-gauge'
                  type='number'
                  min='0.05'
                  max='3'
                  step='0.05'
                  label='Keine-Antwort-Schwelle'
                  v-model.number='conf.noAnswerThreshold'
                  persistent-hint
                  hint='Unterhalb dieses Werts sagt der Bot lieber, dass die Quellen nicht belastbar genug sind.'
                )

            v-switch(
              v-model='conf.enableStreaming'
              inset
              color='primary'
              label='Antworten streamen'
              :disabled='isStreamingToggleDisabled'
              persistent-hint
              :hint='streamingToggleHint'
            )

            v-switch(
              v-model='conf.strictCitationMode'
              inset
              color='primary'
              label='Strikte Quellenbindung'
              persistent-hint
              hint='Verhindert Ableitungen außerhalb der Quellen. Nicht explizit Gesagtes soll klar als fehlend markiert werden.'
            )

            v-textarea.admin-chatbot-prompt-field(
              outlined
              auto-grow
              rows='4'
              prepend-icon='mdi-text-box-outline'
              label='System-Prompt'
              v-model='conf.systemPrompt'
              persistent-hint
              hint='Optionaler Zusatzprompt. Basisregeln, Preset, Antwortmodus und Quellenregeln bleiben trotzdem aktiv.'
            )

            v-textarea.admin-chatbot-prompt-field(
              outlined
              auto-grow
              rows='4'
              prepend-icon='mdi-rename-box'
              label='Such-Aliase / Synonyme'
              v-model='conf.queryAliasesText'
              persistent-hint
              hint='Eine Regel pro Zeile, z. B. urlaubsantrag => urlaub, abwesenheit. Erweitert die Suche um interne Begriffe.'
            )

            v-text-field(
              outlined
              prepend-icon='mdi-calendar-refresh'
              type='number'
              min='0'
              step='1'
              label='Geplanter Sicherheits-Rebuild (Stunden)'
              v-model.number='conf.scheduledRebuildHours'
              persistent-hint
              hint='0 deaktiviert es. Neue und geänderte Seiten werden schon direkt indexiert; das hier ist nur ein zusätzlicher Vollabgleich.'
            )

        v-expansion-panels.mt-4(multiple)
          v-expansion-panel
            v-expansion-panel-header OpenAI
            v-expansion-panel-content
              v-text-field(outlined, prepend-icon='mdi-web', label='OpenAI Base URL', v-model='conf.openaiBaseUrl', persistent-hint, hint='API-Basisadresse für OpenAI oder kompatible Gateways.')
              v-text-field(outlined, prepend-icon='mdi-key-variant', label='OpenAI API-Key', type='password', v-model='conf.openaiApiKey', persistent-hint, hint='Schlüssel für Chat und Embeddings bei OpenAI.')
              v-layout.mb-2(row, wrap)
                v-flex(shrink)
                  v-btn.mr-2(
                    small
                    outlined
                    color='primary'
                    :loading='providerControls.openai.loadingModels'
                    :disabled='!canFetchProviderModels(`openai`)'
                    @click='loadProviderModels(`openai`)'
                  )
                    v-icon(left, small) mdi-refresh
                    span Modelle laden
                v-flex(shrink)
                  v-btn(
                    small
                    outlined
                    color='success'
                    :loading='providerControls.openai.testing'
                    :disabled='!canTestProvider(`openai`)'
                    @click='testProviderConnection(`openai`)'
                  )
                    v-icon(left, small) mdi-connection
                    span Verbindung testen
              v-layout(row, wrap)
                v-flex(lg6, xs12)
                  v-combobox(
                    outlined
                    clearable
                    prepend-icon='mdi-robot'
                    label='OpenAI Chat-Modell'
                    v-model='conf.chatModel'
                    :items='openaiChatModelItems'
                    persistent-hint
                    hint='Wird automatisch geladen, kann aber auch manuell eingetragen werden.'
                  )
                v-flex(lg6, xs12)
                  v-combobox(
                    outlined
                    clearable
                    prepend-icon='mdi-vector-line'
                    label='OpenAI Embedding-Modell'
                    v-model='conf.embeddingModel'
                    :items='openaiEmbeddingModelItems'
                    persistent-hint
                    hint='Modell für die Vektorisierung von Seiten und Suchanfragen.'
                  )
              v-alert.mt-3(
                v-if='providerControls.openai.noticeMessage'
                outlined
                dense
                :value='true'
                :color='providerControls.openai.noticeColor'
                :icon='providerControls.openai.noticeIcon'
              ) {{ providerControls.openai.noticeMessage }}
              v-text-field(
                outlined
                prepend-icon='mdi-numeric'
                type='number'
                min='64'
                step='1'
                label='OpenAI Embedding-Dimensionen'
                v-model.number='conf.embeddingDimensions'
                :disabled='conf.embeddingProvider !== "openai"'
                persistent-hint
                :hint='conf.embeddingProvider === "openai" ? "Wird nur für OpenAI-Embeddings verwendet." : "Wird beim Initialisieren oder Rebuild für den aktiven Anbieter automatisch erkannt."'
              )

          v-expansion-panel
            v-expansion-panel-header Claude (Anthropic)
            v-expansion-panel-content
              v-text-field(outlined, prepend-icon='mdi-web', label='Claude Base URL', v-model='conf.claudeBaseUrl', persistent-hint, hint='API-Basisadresse für Anthropic/Claude.')
              v-text-field(outlined, prepend-icon='mdi-key-variant', label='Claude API-Key', type='password', v-model='conf.claudeApiKey', persistent-hint, hint='Zugangsschlüssel für Claude.')
              v-text-field(outlined, prepend-icon='mdi-robot', label='Claude Modell', v-model='conf.claudeModel', persistent-hint, hint='Chat-Modell für Antworten über Claude.')

          v-expansion-panel
            v-expansion-panel-header Gemini
            v-expansion-panel-content
              v-text-field(outlined, prepend-icon='mdi-web', label='Gemini Base URL', v-model='conf.geminiBaseUrl', persistent-hint, hint='API-Basisadresse für Google Gemini.')
              v-text-field(outlined, prepend-icon='mdi-key-variant', label='Gemini API-Key', type='password', v-model='conf.geminiApiKey', persistent-hint, hint='Schlüssel für Gemini-Chat und Gemini-Embeddings.')
              v-layout(row, wrap)
                v-flex(lg6, xs12)
                  v-text-field(outlined, prepend-icon='mdi-robot', label='Gemini Chat-Modell', v-model='conf.geminiChatModel', persistent-hint, hint='Modell für die Antworterstellung über Gemini.')
                v-flex(lg6, xs12)
                  v-text-field(outlined, prepend-icon='mdi-vector-line', label='Gemini Embedding-Modell', v-model='conf.geminiEmbeddingModel', persistent-hint, hint='Modell für die Vektorsuche über Gemini.')

          v-expansion-panel
            v-expansion-panel-header Mistral
            v-expansion-panel-content
              v-text-field(outlined, prepend-icon='mdi-web', label='Mistral Base URL', v-model='conf.mistralBaseUrl', persistent-hint, hint='API-Basisadresse für Mistral.')
              v-text-field(outlined, prepend-icon='mdi-key-variant', label='Mistral API-Key', type='password', v-model='conf.mistralApiKey', persistent-hint, hint='Schlüssel für Mistral-Chat und Mistral-Embeddings.')
              v-layout(row, wrap)
                v-flex(lg6, xs12)
                  v-text-field(outlined, prepend-icon='mdi-robot', label='Mistral Chat-Modell', v-model='conf.mistralChatModel', persistent-hint, hint='Modell für die Antworterstellung über Mistral.')
                v-flex(lg6, xs12)
                  v-text-field(outlined, prepend-icon='mdi-vector-line', label='Mistral Embedding-Modell', v-model='conf.mistralEmbeddingModel', persistent-hint, hint='Modell für die Vektorsuche über Mistral.')

          v-expansion-panel
            v-expansion-panel-header Ollama
            v-expansion-panel-content
              v-text-field(outlined, prepend-icon='mdi-web', label='Ollama Base URL', v-model='conf.ollamaBaseUrl', persistent-hint, hint='Adresse deiner lokalen oder entfernten Ollama-Instanz.')
              v-layout.mb-2(row, wrap)
                v-flex(shrink)
                  v-btn.mr-2(
                    small
                    outlined
                    color='primary'
                    :loading='providerControls.ollama.loadingModels'
                    :disabled='!canFetchProviderModels(`ollama`)'
                    @click='loadProviderModels(`ollama`)'
                  )
                    v-icon(left, small) mdi-refresh
                    span Modelle laden
                v-flex(shrink)
                  v-btn(
                    small
                    outlined
                    color='success'
                    :loading='providerControls.ollama.testing'
                    :disabled='!canTestProvider(`ollama`)'
                    @click='testProviderConnection(`ollama`)'
                  )
                    v-icon(left, small) mdi-connection
                    span Verbindung testen
              v-layout(row, wrap)
                v-flex(lg6, xs12)
                  v-combobox(
                    outlined
                    clearable
                    prepend-icon='mdi-robot'
                    label='Ollama Chat-Modell'
                    v-model='conf.ollamaChatModel'
                    :items='ollamaChatModelItems'
                    persistent-hint
                    hint='Chat-Modell aus Ollama. Kann automatisch geladen oder manuell eingetragen werden.'
                  )
                v-flex(lg6, xs12)
                  v-combobox(
                    outlined
                    clearable
                    prepend-icon='mdi-vector-line'
                    label='Ollama Embedding-Modell'
                    v-model='conf.ollamaEmbeddingModel'
                    :items='ollamaEmbeddingModelItems'
                    persistent-hint
                    hint='Embedding-Modell aus Ollama für die lokale Vektorsuche.'
                  )
              v-alert.mt-3(
                v-if='providerControls.ollama.noticeMessage'
                outlined
                dense
                :value='true'
                :color='providerControls.ollama.noticeColor'
                :icon='providerControls.ollama.noticeIcon'
              ) {{ providerControls.ollama.noticeMessage }}

      v-flex(lg4, xs12)
        v-card.animated.fadeInUp.wait-p1s
          v-toolbar(flat, color='indigo', dark, dense)
            .subtitle-1 Zugriff & Bereich
          v-card-text
            .caption.mb-3.grey--text
              | Beschränkt die Nutzung des Chatbots auf ausgewählte Gruppen. Leer bedeutet: alle Nutzer mit normalem Seitenzugriff.
            v-autocomplete(
              v-model='conf.allowedGroups'
              :items='groups'
              item-value='id'
              item-text='name'
              multiple
              chips
              small-chips
              deletable-chips
              outlined
              prepend-icon='mdi-account-group'
              label='Erlaubte Gruppen'
              persistent-hint
              hint='Nur diese Gruppen sehen und nutzen den Chatbot.'
            )

            v-divider.my-4

            .caption.mb-3.grey--text
              | Optionale Positivliste für indexierte und durchsuchbare Pfade. Leer bedeutet: alle nicht-privaten Seiten. Beispiele: docs, handbook/hr
            v-combobox(
              v-model='conf.allowedPathPrefixes'
              multiple
              chips
              small-chips
              deletable-chips
              clearable
              outlined
              prepend-icon='mdi-folder-search-outline'
              label='Eingeschlossene Pfad-Präfixe'
              persistent-hint
              hint='Nur diese Bereiche dürfen in den Index und in die Suche.'
            )

            v-divider.my-4

            .caption.mb-3.grey--text
              | Harte Ausschlüsse für Pfade oder einzelne Seiten. Diese Regeln gewinnen immer gegen die Positivliste. Beispiele: confidential, handbook/hr/urlaub
            v-combobox(
              v-model='conf.excludedPathPrefixes'
              multiple
              chips
              small-chips
              deletable-chips
              clearable
              outlined
              prepend-icon='mdi-folder-remove-outline'
              label='Ausgeschlossene Pfade / Seiten'
              persistent-hint
              hint='Diese Bereiche werden weder indexiert noch bei Antworten verwendet.'
            )

            v-divider.my-4

            v-alert(outlined, color='info', icon='mdi-shield-lock-outline', :value='true')
              | Der finale Seitenzugriff wird bei jedem Treffer weiterhin über die Wiki.js-ACL (`checkAccess`) abgesichert.

            v-alert.mt-3(outlined, color='warning', icon='mdi-database-refresh', :value='true')
              | Änderungen an Embeddings, Chunking, einer erweiterten Positivliste oder gelockerten Ausschlüssen brauchen einen manuellen Rebuild. Engerer Scope oder neue Ausschlüsse werden sofort herausgeschnitten.
</template>

<script>
import _ from 'lodash'
import gql from 'graphql-tag'

export default {
  data () {
    return {
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
      status: {
        configuredEnabled: false,
        runtimeEnabled: false,
        canUse: false,
        streamingSupported: false,
        streamingEnabled: false,
        streamingSupportMessage: 'Streaming ist derzeit nicht verfügbar.',
        schemaReady: false,
        schemaEmbeddingDimensions: 0,
        hasPathRestrictions: false,
        currentPathAllowed: true,
        rebuildRecommended: false,
        statusMessage: 'RAG ist in der Konfiguration deaktiviert.',
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
      },
      providerControls: {
        openai: {
          loadingModels: false,
          testing: false,
          streamingChecked: false,
          streamingSupported: false,
          streamingSucceeded: false,
          streamingMessage: '',
          chatModels: [],
          embeddingModels: [],
          noticeMessage: '',
          noticeColor: 'info',
          noticeIcon: 'mdi-information-outline'
        },
        ollama: {
          loadingModels: false,
          testing: false,
          streamingChecked: false,
          streamingSupported: false,
          streamingSucceeded: false,
          streamingMessage: '',
          chatModels: [],
          embeddingModels: [],
          noticeMessage: '',
          noticeColor: 'info',
          noticeIcon: 'mdi-information-outline'
        }
      },
      groups: [],
      pollHandle: null,
      chatProviderItems: [
        { text: 'OpenAI', value: 'openai' },
        { text: 'Claude (Anthropic)', value: 'claude' },
        { text: 'Gemini', value: 'gemini' },
        { text: 'Mistral', value: 'mistral' },
        { text: 'Ollama', value: 'ollama' }
      ],
      answerModeItems: [
        { text: 'Kurz', value: 'short' },
        { text: 'Standard', value: 'standard' },
        { text: 'Detail', value: 'detailed' }
      ],
      promptPresetItems: [
        { text: 'Ausgewogen', value: 'balanced' },
        { text: 'Sehr knapp', value: 'concise' },
        { text: 'Stichpunkte', value: 'bullet' },
        { text: 'Support / Schrittfolge', value: 'support' }
      ],
      embeddingProviderItems: [
        { text: 'OpenAI', value: 'openai' },
        { text: 'Gemini', value: 'gemini' },
        { text: 'Mistral', value: 'mistral' },
        { text: 'Ollama', value: 'ollama' }
      ]
    }
  },
  computed: {
    isRebuildRunning () {
      return _.get(this.status, 'job.status', 'idle') === 'running'
    },
    rebuildButtonText () {
      return this.status.schemaReady ? 'Index neu aufbauen' : 'Initialisieren & Index aufbauen'
    },
    statusColor () {
      if (!this.conf.enabled) {
        return 'grey'
      }
      if (!this.status.runtimeEnabled) {
        return 'warning'
      }
      if (this.isRebuildRunning) {
        return 'deep-orange'
      }
      if (this.status.rebuildRecommended) {
        return 'warning'
      }
      return this.status.schemaReady ? 'success' : 'info'
    },
    statusIcon () {
      if (!this.conf.enabled) {
        return 'mdi-toggle-switch-off-outline'
      }
      if (!this.status.runtimeEnabled) {
        return 'mdi-alert-outline'
      }
      if (this.isRebuildRunning) {
        return 'mdi-progress-clock'
      }
      if (this.status.rebuildRecommended) {
        return 'mdi-refresh-alert'
      }
      return this.status.schemaReady ? 'mdi-check-circle-outline' : 'mdi-database-plus-outline'
    },
    openaiChatModelItems () {
      return this.buildModelItems(_.get(this.providerControls, 'openai.chatModels', []), this.conf.chatModel)
    },
    openaiEmbeddingModelItems () {
      return this.buildModelItems(_.get(this.providerControls, 'openai.embeddingModels', []), this.conf.embeddingModel)
    },
    ollamaChatModelItems () {
      return this.buildModelItems(_.get(this.providerControls, 'ollama.chatModels', []), this.conf.ollamaChatModel)
    },
    ollamaEmbeddingModelItems () {
      return this.buildModelItems(_.get(this.providerControls, 'ollama.embeddingModels', []), this.conf.ollamaEmbeddingModel)
    },
    currentStreamingCapability () {
      switch (_.toString(this.conf.chatProvider || 'openai')) {
        case 'openai':
          return {
            supported: true,
            message: 'OpenAI-kompatible Endpunkte können Streaming unterstützen. Bei Gateways bitte mit "Verbindung testen" prüfen.'
          }
        case 'mistral':
          return {
            supported: true,
            message: 'Der Mistral-Chat-Endpunkt kann Streaming unterstützen.'
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
            message: 'Für diesen Anbieter ist Streaming aktuell nicht verfügbar.'
          }
      }
    },
    currentStreamingProviderControl () {
      return _.get(this.providerControls, _.toString(this.conf.chatProvider || ''), null)
    },
    isStreamingToggleDisabled () {
      if (!this.currentStreamingCapability.supported) {
        return true
      }

      if (_.get(this.currentStreamingProviderControl, 'streamingChecked', false)) {
        return !_.get(this.currentStreamingProviderControl, 'streamingSucceeded', false)
      }

      return false
    },
    streamingToggleHint () {
      if (!this.currentStreamingCapability.supported) {
        return this.currentStreamingCapability.message
      }

      if (_.get(this.currentStreamingProviderControl, 'streamingChecked', false) && !_.get(this.currentStreamingProviderControl, 'streamingSucceeded', false)) {
        return _.get(this.currentStreamingProviderControl, 'streamingMessage', 'Der aktuelle Endpunkt oder das Modell unterstützt Streaming nicht sauber.')
      }

      return 'Zeigt die Antwort während der Generierung schrittweise im Chat an.'
    }
  },
  watch: {
    'status.job.status' (val) {
      if (val === 'running') {
        this.scheduleStatusPoll()
      } else {
        this.stopStatusPoll()
      }
    }
  },
  beforeUnmount () {
    this.stopStatusPoll()
  },
  methods: {
    normalizePathPrefix (value) {
      return _.trim(_.trim(_.toString(value || '')), '/')
    },
    buildModelItems (items, currentValue) {
      return _.uniq([
        _.trim(_.toString(currentValue || '')),
        ...(_.isArray(items) ? items : [])
      ].filter(value => !_.isEmpty(value)))
    },
    setProviderNotice (provider, { message = '', color = 'info', icon = 'mdi-information-outline' } = {}) {
      if (!this.providerControls[provider]) {
        return
      }

      this.providerControls[provider].noticeMessage = message
      this.providerControls[provider].noticeColor = color
      this.providerControls[provider].noticeIcon = icon
    },
    setProviderStreamingStatus (provider, { checked = false, supported = false, succeeded = false, message = '' } = {}) {
      if (!this.providerControls[provider]) {
        return
      }

      this.providerControls[provider].streamingChecked = checked
      this.providerControls[provider].streamingSupported = supported
      this.providerControls[provider].streamingSucceeded = succeeded
      this.providerControls[provider].streamingMessage = message
    },
    providerRequestInput (provider) {
      if (provider === 'openai') {
        return {
          provider,
          baseUrl: _.trim(_.toString(this.conf.openaiBaseUrl || '')),
          apiKey: _.toString(this.conf.openaiApiKey || ''),
          chatModel: _.trim(_.toString(this.conf.chatModel || '')),
          embeddingModel: _.trim(_.toString(this.conf.embeddingModel || ''))
        }
      }

      if (provider === 'ollama') {
        return {
          provider,
          baseUrl: _.trim(_.toString(this.conf.ollamaBaseUrl || '')),
          chatModel: _.trim(_.toString(this.conf.ollamaChatModel || '')),
          embeddingModel: _.trim(_.toString(this.conf.ollamaEmbeddingModel || ''))
        }
      }

      return {
        provider
      }
    },
    canFetchProviderModels (provider) {
      if (provider === 'openai') {
        return !_.isEmpty(_.trim(_.toString(this.conf.openaiBaseUrl || ''))) && !_.isEmpty(_.trim(_.toString(this.conf.openaiApiKey || '')))
      }

      if (provider === 'ollama') {
        return !_.isEmpty(_.trim(_.toString(this.conf.ollamaBaseUrl || '')))
      }

      return false
    },
    canTestProvider (provider) {
      if (provider === 'openai') {
        return this.canFetchProviderModels(provider) &&
          !_.isEmpty(_.trim(_.toString(this.conf.chatModel || ''))) &&
          !_.isEmpty(_.trim(_.toString(this.conf.embeddingModel || '')))
      }

      if (provider === 'ollama') {
        return this.canFetchProviderModels(provider) &&
          !_.isEmpty(_.trim(_.toString(this.conf.ollamaChatModel || ''))) &&
          !_.isEmpty(_.trim(_.toString(this.conf.ollamaEmbeddingModel || '')))
      }

      return false
    },
    async autofetchProviderModels () {
      await Promise.allSettled([
        this.loadProviderModels('openai', { silent: true }),
        this.loadProviderModels('ollama', { silent: true })
      ])
    },
    async loadProviderModels (provider, { silent = false } = {}) {
      if (!this.providerControls[provider] || !this.canFetchProviderModels(provider)) {
        return
      }

      this.providerControls[provider].loadingModels = true

      try {
        const resp = await this.$apollo.mutate({
          mutation: gql`
            mutation ($input: RagProviderConnectionInput!) {
              rag {
                fetchProviderModels(input: $input) {
                  provider
                  chatModels
                  embeddingModels
                }
              }
            }
          `,
          variables: {
            input: this.providerRequestInput(provider)
          }
        })

        const payload = _.get(resp, 'data.rag.fetchProviderModels', {})
        this.providerControls[provider].chatModels = _.get(payload, 'chatModels', [])
        this.providerControls[provider].embeddingModels = _.get(payload, 'embeddingModels', [])

        const chatCount = this.providerControls[provider].chatModels.length
        const embeddingCount = this.providerControls[provider].embeddingModels.length
        const message = `${chatCount} Chat-Modell(e) und ${embeddingCount} Embedding-Modell(e) geladen.`
        this.setProviderNotice(provider, {
          message,
          color: 'success',
          icon: 'mdi-check-circle-outline'
        })

        if (!silent) {
          this.$store.commit('showNotification', {
            message: `${_.upperFirst(provider)}-Modelle erfolgreich geladen.`,
            style: 'success',
            icon: 'check'
          })
        }
      } catch (err) {
        this.setProviderNotice(provider, {
          message: _.get(err, 'message', 'Modelle konnten nicht geladen werden.'),
          color: 'error',
          icon: 'mdi-alert-circle-outline'
        })
        if (!silent) {
          this.$store.commit('pushGraphError', err)
        }
      }

      this.providerControls[provider].loadingModels = false
    },
    async testProviderConnection (provider) {
      if (!this.providerControls[provider] || !this.canTestProvider(provider)) {
        return
      }

      this.providerControls[provider].testing = true

      try {
        const resp = await this.$apollo.mutate({
          mutation: gql`
            mutation ($input: RagProviderConnectionInput!) {
              rag {
                testProviderConnection(input: $input) {
                  provider
                  chatModel
                  embeddingModel
                  chatSucceeded
                  embeddingSucceeded
                  streamingSupported
                  streamingSucceeded
                  chatMessage
                  embeddingMessage
                  streamingMessage
                }
              }
            }
          `,
          variables: {
            input: this.providerRequestInput(provider)
          }
        })

        const payload = _.get(resp, 'data.rag.testProviderConnection', {})
        const chatSucceeded = !!payload.chatSucceeded
        const embeddingSucceeded = !!payload.embeddingSucceeded
        const streamingSupported = !!payload.streamingSupported
        const streamingSucceeded = !!payload.streamingSucceeded
        const succeeded = chatSucceeded && embeddingSucceeded

        this.setProviderStreamingStatus(provider, {
          checked: true,
          supported: streamingSupported,
          succeeded: !streamingSupported || streamingSucceeded,
          message: _.toString(payload.streamingMessage || '')
        })
        this.setProviderNotice(provider, {
          message: `Chat: ${payload.chatMessage} | Embeddings: ${payload.embeddingMessage} | Streaming: ${payload.streamingMessage}`,
          color: succeeded && (!streamingSupported || streamingSucceeded) ? 'success' : 'warning',
          icon: succeeded && (!streamingSupported || streamingSucceeded) ? 'mdi-check-circle-outline' : 'mdi-alert-outline'
        })

        this.$store.commit('showNotification', {
          message: succeeded && (!streamingSupported || streamingSucceeded) ?
            `${_.upperFirst(provider)}: Chat- und Embedding-Test erfolgreich.` :
            `${_.upperFirst(provider)}: Test mit Hinweisen abgeschlossen.`,
          style: succeeded && (!streamingSupported || streamingSucceeded) ? 'success' : 'warning',
          icon: succeeded && (!streamingSupported || streamingSucceeded) ? 'check' : 'alert'
        })
      } catch (err) {
        this.setProviderStreamingStatus(provider, {
          checked: true,
          supported: false,
          succeeded: false,
          message: _.get(err, 'message', 'Streaming-Test fehlgeschlagen.')
        })
        this.setProviderNotice(provider, {
          message: _.get(err, 'message', 'Verbindungstest fehlgeschlagen.'),
          color: 'error',
          icon: 'mdi-alert-circle-outline'
        })
        this.$store.commit('pushGraphError', err)
      }

      this.providerControls[provider].testing = false
    },
    stopStatusPoll () {
      if (this.pollHandle) {
        clearTimeout(this.pollHandle)
        this.pollHandle = null
      }
    },
    scheduleStatusPoll () {
      this.stopStatusPoll()
      this.pollHandle = setTimeout(async () => {
        try {
          await this.$apollo.queries.ragStatus.refetch()
          if (_.get(this.status, 'job.status', 'idle') === 'running') {
            this.scheduleStatusPoll()
          }
        } catch (err) {
          this.$store.commit('pushGraphError', err)
        }
      }, 3000)
    },
    async refresh () {
      await Promise.all([
        this.$apollo.queries.ragConfig.refetch(),
        this.$apollo.queries.ragStatus.refetch(),
        this.$apollo.queries.groups.refetch()
      ])
      await this.autofetchProviderModels()

      this.$store.commit('showNotification', {
        message: 'Chatbot-Einstellungen aktualisiert.',
        style: 'success',
        icon: 'cached'
      })
    },
    async save () {
      this.$store.commit('loadingStart', 'admin-chatbot-save')
      try {
        const payload = {
          ...this.conf,
          allowedGroups: _.uniq((this.conf.allowedGroups || []).map(v => _.toInteger(v)).filter(v => v > 0)),
          allowedPathPrefixes: _.uniq((this.conf.allowedPathPrefixes || []).map(this.normalizePathPrefix).filter(v => v.length > 0)),
          excludedPathPrefixes: _.uniq((this.conf.excludedPathPrefixes || []).map(this.normalizePathPrefix).filter(v => v.length > 0))
        }

        const resp = await this.$apollo.mutate({
          mutation: gql`
            mutation ($config: RagConfigInput!) {
              rag {
                saveConfig(config: $config) {
                  responseResult {
                    succeeded
                    message
                  }
                }
              }
            }
          `,
          variables: {
            config: payload
          }
        })

        if (_.get(resp, 'data.rag.saveConfig.responseResult.succeeded', false)) {
          this.$store.commit('showNotification', {
            message: 'Chatbot-Einstellungen gespeichert.',
            style: 'success',
            icon: 'check'
          })
          await Promise.all([
            this.$apollo.queries.ragConfig.refetch(),
            this.$apollo.queries.ragStatus.refetch()
          ])
        } else {
          throw new Error(_.get(resp, 'data.rag.saveConfig.responseResult.message', 'Unerwarteter Fehler beim Speichern der Einstellungen.'))
        }
      } catch (err) {
        this.$store.commit('pushGraphError', err)
      }
      this.$store.commit('loadingStop', 'admin-chatbot-save')
    },
    async rebuild () {
      this.$store.commit('loadingStart', 'admin-chatbot-rebuild')
      try {
        const resp = await this.$apollo.mutate({
          mutation: gql`
            mutation {
              rag {
                rebuildIndex {
                  responseResult {
                    succeeded
                    message
                  }
                }
              }
            }
          `
        })

        if (_.get(resp, 'data.rag.rebuildIndex.responseResult.succeeded', false)) {
          this.$store.commit('showNotification', {
            message: _.get(resp, 'data.rag.rebuildIndex.responseResult.message', 'RAG-Rebuild wurde im Hintergrund gestartet.'),
            style: 'success',
            icon: 'check'
          })
          await this.$apollo.queries.ragStatus.refetch()
          this.scheduleStatusPoll()
        } else {
          throw new Error(_.get(resp, 'data.rag.rebuildIndex.responseResult.message', 'Unerwarteter Fehler beim Neuaufbau des Index.'))
        }
      } catch (err) {
        this.$store.commit('pushGraphError', err)
      }
      this.$store.commit('loadingStop', 'admin-chatbot-rebuild')
    }
  },
  apollo: {
    ragConfig: {
      query: gql`
        {
          rag {
            config {
              enabled
              autoBootstrap
              chatProvider
              embeddingProvider
              maxChunkChars
              chunkOverlapChars
              maxCandidates
              defaultTopK
              embeddingModel
              embeddingDimensions
              chatModel
              systemPrompt
              defaultAnswerMode
              promptPreset
              noAnswerThreshold
              strictCitationMode
              queryAliasesText
              scheduledRebuildHours
              enableSearchButton
              enableStreaming
              openaiBaseUrl
              openaiApiKey
              claudeBaseUrl
              claudeApiKey
              claudeModel
              geminiBaseUrl
              geminiApiKey
              geminiChatModel
              geminiEmbeddingModel
              mistralBaseUrl
              mistralApiKey
              mistralChatModel
              mistralEmbeddingModel
              ollamaBaseUrl
              ollamaChatModel
              ollamaEmbeddingModel
              requestTimeoutMs
              allowedGroups
              allowedPathPrefixes
              excludedPathPrefixes
            }
          }
        }
      `,
      fetchPolicy: 'network-only',
      update: data => _.get(data, 'rag.config', {}),
      result ({ data }) {
        this.conf = {
          ...this.conf,
          ..._.get(data, 'rag.config', {})
        }
        this.$nextTick(() => {
          this.autofetchProviderModels()
        })
      },
      watchLoading (isLoading) {
        this.$store.commit(`loading${isLoading ? 'Start' : 'Stop'}`, 'admin-chatbot-refresh')
      }
    },
    ragStatus: {
      query: gql`
        {
          rag {
            status {
              configuredEnabled
              runtimeEnabled
              canUse
              streamingSupported
              streamingEnabled
              streamingSupportMessage
              schemaReady
              schemaEmbeddingDimensions
              hasPathRestrictions
              currentPathAllowed
              rebuildRecommended
              statusMessage
              metadata {
                embeddingProvider
                embeddingModel
                embeddingDimensions
                maxChunkChars
                chunkOverlapChars
                chunkingStrategy
                allowedPathPrefixes
                excludedPathPrefixes
                indexedPages
                indexedChunks
                status
                message
                lastBuildStartedAt
                lastBuildCompletedAt
                createdAt
                updatedAt
              }
              job {
                status
                progress
                message
                startedAt
                completedAt
                processedPages
                totalPages
                indexedPages
                indexedChunks
              }
            }
          }
        }
      `,
      fetchPolicy: 'network-only',
      update: data => _.get(data, 'rag.status', {}),
      result ({ data }) {
        this.status = {
          ...this.status,
          ..._.get(data, 'rag.status', {})
        }
      }
    },
    groups: {
      query: gql`
        {
          groups {
            list(orderBy: "name") {
              id
              name
            }
          }
        }
      `,
      fetchPolicy: 'network-only',
      update: data => _.get(data, 'groups.list', [])
    }
  }
}
</script>

<style lang='scss'>
.admin-chatbot-prompt-field {
  margin-top: 22px;
}
</style>
