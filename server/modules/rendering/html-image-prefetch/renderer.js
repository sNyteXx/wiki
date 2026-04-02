const prefetch = async (element) => {
  const url = element.attr(`src`)
  let response
  try {
    response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch (err) {
    WIKI.logger.warn(`Failed to prefetch ${url}`)
    WIKI.logger.warn(err)
    return
  }
  const contentType = response.headers.get(`content-type`)
  const buf = Buffer.from(await response.arrayBuffer())
  const image = buf.toString('base64')
  element.attr('src', `data:${contentType};base64,${image}`)
  element.removeClass('prefetch-candidate')
}

module.exports = {
  async init($) {
    const promises = $('img.prefetch-candidate').map((index, element) => {
      return prefetch($(element))
    }).toArray()
    await Promise.all(promises)
  }
}
