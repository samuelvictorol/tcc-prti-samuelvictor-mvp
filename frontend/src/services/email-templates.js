const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i
const FLATTENED_HTML_PATTERN = /\b(?:html|body|div|table|tbody|thead|tr|td|p|span|a|h[1-6])\s+(?:style|class|href|width|height)=/i

export function looksLikeFlattenedEmailHtml(value = '') {
  const source = String(value || '').trim()
  return Boolean(source && !HTML_TAG_PATTERN.test(source) && FLATTENED_HTML_PATTERN.test(source))
}

export function emailHtmlToPlainText(value = '') {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
