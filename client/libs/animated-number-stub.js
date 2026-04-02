/**
 * Stub replacement for animated-number-vue (Vue 2 only package)
 * Renders the formatted number value directly with a simple transition.
 */
export default {
  name: 'AnimatedNumber',
  props: {
    value: {
      type: Number,
      default: 0
    },
    formatValue: {
      type: Function,
      default: (v) => v
    },
    duration: {
      type: Number,
      default: 300
    }
  },
  render () {
    return this.$slots.default
      ? this.$slots.default({ displayValue: this.formatValue(this.value) })
      : null
  },
  template: '<span>{{ formatValue(value) }}</span>'
}
