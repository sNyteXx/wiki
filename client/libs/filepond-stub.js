/**
 * Stub replacement for vue-filepond (Vue 2 only package)
 * Returns a minimal component that renders a file input.
 */
export default function vueFilePond () {
  return {
    name: 'FilePond',
    props: {
      name: { type: String, default: 'file' },
      server: { type: Object, default: () => ({}) },
      labelIdle: { type: String, default: 'Drop files here or click to browse' },
      allowMultiple: { type: Boolean, default: false },
      maxFiles: { type: Number, default: null },
      acceptedFileTypes: { type: Array, default: () => [] }
    },
    emits: ['processfile', 'removefile'],
    template: `<div class="filepond-stub">
      <input type="file" :name="name" :multiple="allowMultiple" :accept="acceptedFileTypes.join(',')" @change="handleChange" />
      <p>{{ labelIdle }}</p>
    </div>`,
    methods: {
      handleChange (e) {
        const files = e.target.files
        for (let i = 0; i < files.length; i++) {
          this.$emit('processfile', null, { file: files[i] })
        }
      },
      removeFiles () {
        // stub
      }
    }
  }
}
