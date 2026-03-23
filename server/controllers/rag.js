const express = require('express')
const _ = require('lodash')

const router = express.Router()

/* global WIKI */

router.post('/rag/stream', async (req, res) => {
  const query = _.trim(_.toString(_.get(req, 'body.query', '')))

  if (!WIKI.rag || !WIKI.rag.enabled) {
    return res.status(503).json({
      message: 'RAG ist nicht aktiviert.'
    })
  }

  const streamingCapability = WIKI.rag.getStreamingCapability()
  if (!WIKI.rag.isStreamingEnabled()) {
    return res.status(400).json({
      message: streamingCapability.supported ? 'Streaming ist aktuell deaktiviert.' : streamingCapability.message
    })
  }

  if (!WIKI.rag.isUserAllowed(req.user)) {
    return res.status(403).json({
      message: 'Du hast keine Berechtigung, den Chatbot zu verwenden.'
    })
  }

  if (!query) {
    return res.status(400).json({
      message: 'Es wurde keine Frage übergeben.'
    })
  }

  let clientClosed = false
  let streamControl = null

  const sendEvent = (eventName, payload = {}) => {
    if (clientClosed || res.writableEnded) {
      return
    }

    res.write(`event: ${eventName}\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    if (_.isFunction(res.flush)) {
      res.flush()
    }
  }

  const handleClose = () => {
    clientClosed = true
    if (streamControl && _.isFunction(streamControl.cancel)) {
      streamControl.cancel()
    }
  }

  req.on('close', handleClose)
  res.on('close', handleClose)

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  if (_.isFunction(res.flushHeaders)) {
    res.flushHeaders()
  }

  sendEvent('ready', {
    ok: true
  })

  try {
    streamControl = WIKI.rag.createAnswerStream(query, {
      locale: _.get(req, 'body.locale', null),
      path: _.get(req, 'body.path', null),
      pathMode: _.get(req, 'body.pathMode', 'PREFIX'),
      topK: _.get(req, 'body.topK', null),
      answerMode: _.get(req, 'body.answerMode', null),
      history: _.get(req, 'body.history', []),
      user: req.user
    }, {
      onToken: async (delta) => {
        sendEvent('token', { delta })
      },
      onComplete: async ({ answer, chunks }) => {
        sendEvent('done', {
          answer,
          chunks
        })
      }
    })

    await streamControl.promise

    if (!clientClosed && !res.writableEnded) {
      res.end()
    }
  } catch (err) {
    if (clientClosed || res.writableEnded) {
      return
    }

    sendEvent('error', {
      message: _.toString(_.get(err, 'message', 'Streaming ist fehlgeschlagen.'))
    })
    res.end()
  }
})

module.exports = router
