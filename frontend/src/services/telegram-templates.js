export const TELEGRAM_TEMPLATE_KIND_OPTIONS = Object.freeze([
  Object.freeze({ value: 'text', label: 'Texto simples', icon: 'notes', description: 'Mensagem sem HTML, com até 4.096 caracteres.' }),
  Object.freeze({ value: 'photo', label: 'Imagem', icon: 'image', description: 'Imagem HTTPS validada e enviada pelo servidor.' }),
  Object.freeze({ value: 'video', label: 'Vídeo', icon: 'movie', description: 'Vídeo MP4 HTTPS validado antes do envio.' }),
  Object.freeze({ value: 'menu', label: 'Menu interativo', icon: 'account_tree', description: 'Páginas, submenus, links e botão Voltar automáticos.' }),
])

let sequence = 0

function nextId(prefix) {
  sequence += 1
  return `${prefix}_${Date.now().toString(36).slice(-6)}${sequence.toString(36)}`.slice(0, 24)
}

export function createTelegramButton(action = 'url', overrides = {}) {
  return {
    id: overrides.id || nextId('botao'),
    label: overrides.label || (action === 'submenu' ? 'Abrir submenu' : 'Abrir link'),
    action,
    ...(action === 'submenu'
      ? { targetNodeId: overrides.targetNodeId || '' }
      : { url: overrides.url || 'https://' }),
  }
}

export function createTelegramMenuNode(overrides = {}) {
  return {
    id: overrides.id || nextId('pagina'),
    parentId: overrides.parentId || null,
    title: overrides.title || 'Nova página',
    text: overrides.text || '',
    rows: (overrides.rows || []).map((row) => row.map((button) => createTelegramButton(button.action, button))),
  }
}

export function createTelegramDefinition(kind = 'text') {
  if (kind === 'photo') return { version: 1, kind, mediaUrl: 'https://', caption: '' }
  if (kind === 'video') return { version: 1, kind, mediaUrl: 'https://', caption: '' }
  if (kind === 'menu') {
    const root = createTelegramMenuNode({ title: 'Menu principal' })
    return { version: 1, kind, rootNodeId: root.id, nodes: [root] }
  }
  return { version: 1, kind: 'text', text: '' }
}

export function normalizeTelegramDefinition(value, fallbackBody = '') {
  if (!value || typeof value !== 'object') return { version: 1, kind: 'text', text: String(fallbackBody || '') }
  if (value.kind === 'menu') {
    const nodes = (value.nodes || []).map((node) => createTelegramMenuNode(node))
    const root = nodes.find((node) => node.id === value.rootNodeId) || nodes[0] || createTelegramMenuNode({ title: 'Menu principal' })
    if (!nodes.length) nodes.push(root)
    root.parentId = null
    return { version: 1, kind: 'menu', rootNodeId: root.id, nodes }
  }
  if (value.kind === 'photo' || value.kind === 'video') {
    return { version: 1, kind: value.kind, mediaUrl: String(value.mediaUrl || 'https://'), caption: String(value.caption || '') }
  }
  return {
    version: 1,
    kind: 'text',
    text: String(value.text ?? fallbackBody ?? ''),
    ...(value.disableLinkPreview ? { disableLinkPreview: true } : {}),
  }
}

export function telegramDefinitionFromTemplate(template = {}) {
  return normalizeTelegramDefinition(template.payload?.telegram, template.body || '')
}

export function telegramRootNode(definition) {
  return definition?.nodes?.find((node) => node.id === definition.rootNodeId) || definition?.nodes?.[0] || null
}

export function telegramDefinitionBody(definition = {}) {
  if (definition.kind === 'text') return String(definition.text || '')
  if (definition.kind === 'photo' || definition.kind === 'video') return String(definition.caption || '')
  const root = telegramRootNode(definition)
  return [root?.title, root?.text].map((value) => String(value || '').trim()).filter(Boolean).join('\n\n')
}

export function telegramVariables(definition = {}) {
  const variables = new Set()
  const visit = (value) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g)) variables.add(match[1])
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(definition)
  return [...variables]
}

function validHttps(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
  } catch {
    return false
  }
}

export function telegramDefinitionError(definition = {}) {
  if (definition.kind === 'text') {
    if (!String(definition.text || '').trim()) return 'Escreva o texto do template Telegram.'
    if (String(definition.text).length > 4096) return 'O texto excede 4.096 caracteres.'
    return null
  }
  if (definition.kind === 'photo' || definition.kind === 'video') {
    if (!validHttps(definition.mediaUrl)) return 'Informe uma URL HTTPS pública, sem credenciais ou porta personalizada.'
    if (String(definition.caption || '').length > 1024) return 'A legenda excede 1.024 caracteres.'
    return null
  }
  if (definition.kind !== 'menu') return 'Selecione um tipo de template Telegram.'
  const nodes = definition.nodes || []
  if (!nodes.length || nodes.length > 30) return 'O menu deve possuir entre uma e 30 páginas.'
  const ids = nodes.map((node) => node.id)
  if (new Set(ids).size !== ids.length) return 'Cada página deve possuir um identificador único.'
  const known = new Set(ids)
  if (!known.has(definition.rootNodeId)) return 'A página inicial do menu não existe.'
  for (const node of nodes) {
    if (!String(node.title || '').trim()) return 'Informe o título de todas as páginas.'
    if (`${node.title || ''}${node.text ? `\n\n${node.text}` : ''}`.length > 4096) return `A página “${node.title}” excede 4.096 caracteres.`
    if ((node.rows || []).length > 8) return `A página “${node.title}” excede oito linhas de botões.`
    for (const row of node.rows || []) {
      if (!row.length || row.length > 4) return 'Cada linha deve possuir entre um e quatro botões.'
      for (const button of row) {
        if (!String(button.label || '').trim()) return 'Informe o rótulo de todos os botões.'
        if (button.action === 'url' && !validHttps(button.url)) return `O botão “${button.label}” precisa de um link HTTPS válido.`
        if (button.action === 'submenu' && !known.has(button.targetNodeId)) return `O submenu “${button.label}” aponta para uma página inexistente.`
      }
    }
  }
  return null
}
