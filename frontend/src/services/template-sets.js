const CHANNEL_KEYS = Object.freeze({
  whatsapp_cloud: 'whatsappCloud',
  telegram: 'telegram',
  email: 'email',
})

export const TEMPLATE_SET_CHANNELS = Object.freeze(Object.keys(CHANNEL_KEYS))

export function templateSetId(record = {}) {
  return record.id || record._id || null
}

function referenceId(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  return value.id || value._id || value.templateId || null
}

export function templateSetTemplateIds(record = {}) {
  const templates = record.templates || record.templateIds || {}
  return {
    whatsapp_cloud: referenceId(templates[CHANNEL_KEYS.whatsapp_cloud] ?? templates.whatsapp_cloud),
    telegram: referenceId(templates[CHANNEL_KEYS.telegram]),
    email: referenceId(templates[CHANNEL_KEYS.email]),
  }
}

export function templateSetChannels(record = {}) {
  const ids = templateSetTemplateIds(record)
  return TEMPLATE_SET_CHANNELS.filter((channel) => Boolean(ids[channel]))
}

export function templateSetPayload(record = {}) {
  const sourceIds = record.templateIds || templateSetTemplateIds(record)
  const inviteReference = Object.prototype.hasOwnProperty.call(record, 'inviteId')
    ? record.inviteId
    : record.invite
  const templateIds = Object.fromEntries(TEMPLATE_SET_CHANNELS
    .filter((channel) => Boolean(sourceIds[channel]))
    .map((channel) => [channel, sourceIds[channel]]))

  return {
    name: String(record.name || '').trim(),
    description: String(record.description || '').trim() || null,
    inviteId: referenceId(inviteReference) || null,
    templateIds,
  }
}

export function templateSetWithTemplate(record, channel, templateId) {
  const templateIds = templateSetTemplateIds(record)
  templateIds[channel] = templateId || null
  return templateSetPayload({ ...record, templateIds })
}

export function templateSetContains(record, channel, templateId) {
  return String(templateSetTemplateIds(record)[channel] || '') === String(templateId || '')
}

export function templateSetLinkResultSummary(results = []) {
  const succeeded = results.filter((result) => result?.status === 'fulfilled').length
  const rejected = results.filter((result) => result?.status === 'rejected')
  return {
    succeeded,
    failed: rejected.length,
    firstError: rejected[0]?.reason,
  }
}
