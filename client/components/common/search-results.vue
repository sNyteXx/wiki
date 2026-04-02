<template lang="pug">
  .search-results(v-if='searchIsFocused || (search && search.length > 1)')
    .search-results-container
      .search-results-help(v-if='!search || (search && search.length < 2)')
        img(src='/_assets/svg/icon-search-alt.svg')
        .mt-4 {{$t('common:header.searchHint')}}
      .search-results-loader(v-else-if='searchIsLoading && (!results || results.length < 1)')
        orbit-spinner(
          :animation-duration='1000'
          :size='100'
          color='#FFF'
        )
        .headline.mt-5 {{$t('common:header.searchLoading')}}
      .search-results-none(v-else-if='!searchIsLoading && (!results || results.length < 1)')
        img(src='/_assets/svg/icon-no-results.svg', alt='No Results')
        .subheading {{$t('common:header.searchNoResult')}}
      template(v-if='search && search.length >= 2 && results && results.length > 0')
        v-subheader.white--text {{$t('common:header.searchResultsCount', { total: response.totalHits })}}
        v-list.search-results-items.radius-7.py-0(two-line, dense)
          template(v-for='(item, idx) of results', :key='idx')
            v-list-item(@click='goToPage(item)', @click.middle="goToPageInNewTab(item)", :class='idx === cursor ? `highlighted` : ``')
              v-list-item-avatar(tile)
                img(src='/_assets/svg/icon-selective-highlighting.svg')
              v-list-item-content
                v-list-item-title(v-text='item.title')
                v-list-item-subtitle.caption(v-text='item.description')
                .caption.grey--text(v-text='item.path')
              v-list-item-action
                v-chip(label, outlined) {{item.locale.toUpperCase()}}
            v-divider(v-if='idx < results.length - 1')
        v-pagination.mt-3(
          v-if='paginationLength > 1'
          dark
          v-model='pagination'
          :length='paginationLength'
          circle
        )
      .search-results-ai-actions(v-if='canShowAiButton')
        v-btn.search-results-ai-btn(
          outlined
          color='deep-orange darken-2'
          :loading='aiLoading'
          @click='runAiSearch'
        )
          img.search-results-ai-btn-icon(:src='aiIconUrl', alt='AI')
          span {{ aiLoading ? 'Suche läuft…' : 'Mit AI suchen' }}
      .search-results-ai(v-if='aiMode')
        v-subheader.white--text
          img.search-results-ai-header-icon(:src='aiIconUrl', alt='AI')
          span AI-Ergebnisse
        v-list.search-results-ai-items.radius-7.py-0(two-line, dense)
          template(v-if='aiResults.length > 0')
            template(v-for='(item, idx) of aiResults', :key='idx')
              v-list-item(@click='goToPage(item)', @click.middle='goToPageInNewTab(item)')
                v-list-item-avatar(tile)
                  img.search-results-ai-item-icon(:src='aiIconUrl', alt='AI')
                v-list-item-content
                  v-list-item-title(v-text='item.title')
                  v-list-item-subtitle.caption(v-text='truncateAiChunk(item.chunk)')
                  .caption.grey--text(v-text='item.path')
                v-list-item-action
                  v-chip(label, outlined, color='deep-orange darken-2') AI
              v-divider(v-if='idx < aiResults.length - 1')
          .search-results-ai-empty(v-else-if='!aiLoading')
            .caption.white--text Keine AI-Ergebnisse gefunden.
      template(v-if='suggestions && suggestions.length > 0')
        v-subheader.white--text.mt-3 {{$t('common:header.searchDidYouMean')}}
        v-list.search-results-suggestions.radius-7(dense, dark)
          template(v-for='(term, idx) of suggestions', :key='idx')
            v-list-item(, @click='setSearchTerm(term)', :class='idx + results.length === cursor ? `highlighted` : ``')
              v-list-item-avatar
                v-icon mdi-magnify
              v-list-item-content
                v-list-item-title(v-text='term')
            v-divider(v-if='idx < suggestions.length - 1')
      .text-xs-center.pt-5(v-if='search && search.length > 1')
        //- v-btn.mx-2(outlined, color='orange', @click='search = ``', v-if='results.length > 0')
        //-   v-icon(left) mdi-content-save
        //-   span {{$t('common:header.searchCopyLink')}}
        v-btn.mx-2(outlined, color='pink', @click='search = ``')
          v-icon(left) mdi-close
          span {{$t('common:header.searchClose')}}
</template>

<script>
import _ from 'lodash'
import gql from 'graphql-tag'
import { OrbitSpinner } from 'epic-spinners'

import searchPagesQuery from 'gql/common/common-pages-query-search.gql'
import ragSearchQuery from 'gql/common/common-rag-search.gql'

const AI_ICON_URL = '/_assets/img/ai-assistant.png'
const ragViewerStateQuery = gql`
  query {
    rag {
      viewerState {
        searchButtonEnabled
      }
    }
  }
`

export default {
  components: {
    OrbitSpinner
  },
  data() {
    return {
      cursor: 0,
      pagination: 1,
      perPage: 10,
      aiIconUrl: AI_ICON_URL,
      aiMode: false,
      aiLoading: false,
      aiResults: [],
      ragSearchButtonEnabled: false,
      response: {
        results: [],
        suggestions: [],
        totalHits: 0
      }
    }
  },
  computed: {
    search: sync('site/search'),
    searchIsFocused: sync('site/searchIsFocused'),
    searchIsLoading: sync('site/searchIsLoading'),
    searchRestrictLocale: sync('site/searchRestrictLocale'),
    searchRestrictPath: sync('site/searchRestrictPath'),
    isAuthenticated: get('user/authenticated'),
    results() {
      const currentIndex = (this.pagination - 1) * this.perPage
      return this.response.results ? _.slice(this.response.results, currentIndex, currentIndex + this.perPage) : []
    },
    hits() {
      return this.response.totalHits ? this.response.totalHits : 0
    },
    suggestions() {
      return this.response.suggestions ? this.response.suggestions : []
    },
    paginationLength() {
      return (this.response.totalHits > 0) ? Math.ceil(this.response.totalHits / this.perPage) : 0
    },
    canShowAiButton () {
      return !!this.isAuthenticated && !!this.ragSearchButtonEnabled && !!this.search && this.search.length >= 2
    }
  },
  watch: {
    search(newValue) {
      this.cursor = 0
      this.resetAiSearchState()
      if (!newValue || (newValue && newValue.length < 2)) {
        this.searchIsLoading = false
      } else {
        this.searchIsLoading = true
      }
    },
    results() {
      this.cursor = 0
    },
    isAuthenticated: {
      immediate: true,
      handler(val) {
        if (val) {
          this.loadAiAvailability()
        } else {
          this.ragSearchButtonEnabled = false
          this.resetAiSearchState()
        }
      }
    }
  },
  mounted() {
    this.$eventBus.$on('searchMove', (dir) => {
      this.cursor += ((dir === 'up') ? -1 : 1)
      if (this.cursor < -1) {
        this.cursor = -1
      } else if (this.cursor > this.results.length + this.suggestions.length - 1) {
        this.cursor = this.results.length + this.suggestions.length - 1
      }
    })
    this.$eventBus.$on('searchEnter', () => {
      if (!this.results) {
        return
      }

      if (this.cursor >= 0 && this.cursor < this.results.length) {
        this.goToPage(_.nth(this.results, this.cursor))
      } else if (this.cursor >= 0) {
        this.setSearchTerm(_.nth(this.suggestions, this.cursor - this.results.length))
      }
    })
  },
  methods: {
    resetAiSearchState () {
      this.aiMode = false
      this.aiLoading = false
      this.aiResults = []
    },
    async loadAiAvailability () {
      try {
        const resp = await this.$apollo.query({
          query: ragViewerStateQuery,
          fetchPolicy: 'network-only'
        })
        this.ragSearchButtonEnabled = !!_.get(resp, 'data.rag.viewerState.searchButtonEnabled', false)
      } catch (err) {
        this.ragSearchButtonEnabled = false
      }
    },
    normalizeAiResults (items) {
      return _.uniqBy(items || [], item => `${item.locale}:${item.path}`)
    },
    truncateAiChunk (chunk) {
      const text = _.trim(_.toString(chunk || '').replace(/\s+/g, ' '))
      if (text.length <= 150) {
        return text
      }
      return `${text.slice(0, 150).trim()}…`
    },
    async runAiSearch () {
      if (!this.canShowAiButton || this.aiLoading) {
        return
      }

      this.aiMode = true
      this.aiLoading = true

      try {
        const resp = await this.$apollo.query({
          query: ragSearchQuery,
          variables: {
            query: this.search,
            topK: 8
          },
          fetchPolicy: 'network-only'
        })

        const rawResults = _.get(resp, 'data.rag.search', [])
        this.aiResults = this.normalizeAiResults(rawResults)
      } catch (err) {
        this.aiResults = []
        this.$store.commit('pushGraphError', err)
      } finally {
        this.aiLoading = false
      }
    },
    setSearchTerm(term) {
      this.search = term
    },
    goToPage(item) {
      window.location.assign(`/${item.locale}/${item.path}`)
    },
    goToPageInNewTab(item) {
      window.open(`/${item.locale}/${item.path}`, '_blank')
    }
  },
  apollo: {
    response: {
      query: searchPagesQuery,
      variables() {
        return {
          query: this.search
        }
      },
      fetchPolicy: 'network-only',
      debounce: 300,
      throttle: 1000,
      skip() {
        return !this.search || this.search.length < 2
      },
      result() {
        this.pagination = 1
      },
      update: (data) => _.get(data, 'pages.search', {}),
      watchLoading (isLoading) {
        this.searchIsLoading = isLoading
      }
    }
  }
}
</script>

<style lang="scss">
.search-results {
  position: fixed;
  top: 64px;
  left: 0;
  overflow-y: auto;
  width: 100%;
  height: calc(100% - 64px);
  background-color: rgba(0,0,0,.9);
  z-index: 100;
  text-align: center;
  animation: searchResultsReveal .6s ease;

  @media #{map-get($display-breakpoints, 'sm-and-down')} {
    top: 112px;
  }

  &-container {
    margin: 12px auto;
    width: 90vw;
    max-width: 1024px;
  }

  &-help {
    text-align: center;
    padding: 32px 0;
    font-size: 18px;
    font-weight: 300;
    color: #FFF;

    img {
      width: 104px;
    }
  }

  &-loader {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    padding: 32px 0;
    color: #FFF;
  }

  &-none {
    color: #FFF;

    img {
      width: 200px;
    }
  }

  &-items {
    text-align: left;

    .highlighted {
      background: #FFF linear-gradient(to bottom, #FFF, mc('orange', '100'));

      @at-root .theme--dark & {
        background: mc('grey', '900') linear-gradient(to bottom, mc('orange', '900'), darken(mc('orange', '900'), 15%));
      }
    }
  }

  &-suggestions {
    .highlighted {
      background: transparent linear-gradient(to bottom, mc('blue', '500'), mc('blue', '700'));
    }
  }

  &-ai-actions {
    display: flex;
    justify-content: center;
    margin-top: 18px;
  }

  &-ai-btn {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
  }

  &-ai-btn-icon,
  &-ai-header-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
    margin-right: 8px;
    filter: brightness(0) invert(1);
  }

  &-ai {
    margin-top: 12px;
    text-align: left;

    .v-subheader {
      gap: 8px;
    }
  }

  &-ai-items {
    text-align: left;
  }

  &-ai-item-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    filter: brightness(0) invert(1);
  }

  &-ai-empty {
    display: flex;
    justify-content: center;
    padding: 16px 0 4px;
  }
}

@keyframes searchResultsReveal {
  0% {
    background-color: rgba(0,0,0,0);
    padding-top: 32px;
  }
  100% {
    background-color: rgba(0,0,0,.9);
    padding-top: 0;
  }
}
</style>
