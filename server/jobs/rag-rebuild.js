/* global WIKI */

module.exports = async () => {
  if (!WIKI.rag || !WIKI.rag.enabled) {
    return
  }

  if (WIKI.rag.getJobStatus().status === 'running') {
    WIKI.logger.info('(RAG) Scheduled safety rebuild skipped because another rebuild is already running.')
    return
  }

  const schemaState = await WIKI.rag.getSchemaState()
  if (!schemaState.ready) {
    WIKI.logger.info('(RAG) Scheduled safety rebuild skipped because storage is not initialized.')
    return
  }

  await WIKI.rag.rebuildIndex({ allowSchemaCreate: false })
}
