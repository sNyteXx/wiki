const { rateLimitDirective } = require('graphql-rate-limit-directive')

const { rateLimitDirectiveTypeDefs, rateLimitDirectiveTransformer } = rateLimitDirective({
  keyGenerator: (directiveArgs, source, args, context, info) => `${context.req.ip}:${info.parentType}.${info.fieldName}`
})

module.exports = { rateLimitDirectiveTypeDefs, rateLimitDirectiveTransformer }
