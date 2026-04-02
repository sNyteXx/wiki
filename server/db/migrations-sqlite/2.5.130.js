exports.up = async knex => {
  await knex.schema.alterTable('pages', table => {
    table.boolean('isReviewDraft').notNullable().defaultTo(false)
    table.string('reviewStatus').notNullable().defaultTo('none')
    table.integer('reviewOwnerId')
    table.string('reviewSubmittedAt')
    table.string('reviewDecisionAt')
    table.integer('reviewDecisionById')
    table.text('reviewDecisionNote')
    table.index(['isReviewDraft', 'reviewStatus'], 'pages_review_status_idx')
    table.index(['reviewOwnerId', 'isReviewDraft'], 'pages_review_owner_idx')
  })
}

exports.down = async knex => {
  await knex.schema.alterTable('pages', table => {
    table.dropIndex(['isReviewDraft', 'reviewStatus'], 'pages_review_status_idx')
    table.dropIndex(['reviewOwnerId', 'isReviewDraft'], 'pages_review_owner_idx')
    table.dropColumn('reviewDecisionNote')
    table.dropColumn('reviewDecisionById')
    table.dropColumn('reviewDecisionAt')
    table.dropColumn('reviewSubmittedAt')
    table.dropColumn('reviewOwnerId')
    table.dropColumn('reviewStatus')
    table.dropColumn('isReviewDraft')
  })
}
