const { mapSchema, getDirective, MapperKind } = require('@graphql-tools/utils')
const { defaultFieldResolver } = require('graphql')
const _ = require('lodash')

function authDirectiveTransformer(schema, directiveName = 'auth') {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, _fieldName, typeName, schema) => {
      const authDirective = getDirective(schema, fieldConfig, directiveName)?.[0]

      // Also check the parent type for the directive
      const typeDirective = getDirective(schema, schema.getType(typeName), directiveName)?.[0]

      const requiredScopes = authDirective?.requires || typeDirective?.requires

      if (requiredScopes) {
        const { resolve = defaultFieldResolver } = fieldConfig
        fieldConfig.resolve = async function (source, args, context, info) {
          if (!context.req.user) {
            throw new Error('Unauthorized')
          }
          if (!_.some(context.req.user.permissions, pm => _.includes(requiredScopes, pm))) {
            throw new Error('Forbidden')
          }
          return resolve(source, args, context, info)
        }
      }
      return fieldConfig
    }
  })
}

module.exports = authDirectiveTransformer
