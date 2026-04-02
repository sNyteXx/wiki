/**
 * Stub replacement for vuescroll (Vue 2 only package)
 * Simple pass-through wrapper with overflow scrolling.
 */
export default {
  name: 'VueScroll',
  props: {
    ops: {
      type: Object,
      default: () => ({})
    }
  },
  template: '<div style="overflow: auto; height: 100%;"><slot></slot></div>'
}
