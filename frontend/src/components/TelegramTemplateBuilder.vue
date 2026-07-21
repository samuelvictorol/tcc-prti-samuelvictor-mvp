<script setup>
import { computed, ref, watch } from 'vue'
import {
  TELEGRAM_TEMPLATE_KIND_OPTIONS,
  createTelegramButton,
  createTelegramDefinition,
  createTelegramMenuNode,
  normalizeTelegramDefinition,
  telegramDefinitionBody,
} from '../services/telegram-templates.js'

const props = defineProps({ modelValue: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])

const draft = ref(normalizeTelegramDefinition(props.modelValue))
const selectedNodeId = ref(draft.value.rootNodeId || null)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

watch(() => props.modelValue, (value) => {
  const normalized = normalizeTelegramDefinition(value)
  if (JSON.stringify(normalized) !== JSON.stringify(draft.value)) draft.value = normalized
  if (normalized.kind === 'menu' && !normalized.nodes.some((node) => node.id === selectedNodeId.value)) {
    selectedNodeId.value = normalized.rootNodeId
  }
}, { deep: true })

watch(draft, (value) => emit('update:modelValue', clone(value)), { deep: true })

const selectedNode = computed(() => (
  draft.value.kind === 'menu'
    ? draft.value.nodes.find((node) => node.id === selectedNodeId.value) || draft.value.nodes[0]
    : null
))

const previewButtons = computed(() => {
  if (!selectedNode.value) return []
  const rows = clone(selectedNode.value.rows || [])
  if (selectedNode.value.parentId) rows.push([{ id: 'preview-back', label: '← Voltar', action: 'submenu' }])
  return rows
})

function setKind(kind) {
  draft.value = createTelegramDefinition(kind)
  selectedNodeId.value = draft.value.rootNodeId || null
}

function ensureButtonRow(node) {
  if (!node.rows.length || node.rows[node.rows.length - 1].length >= 4) node.rows.push([])
  return node.rows[node.rows.length - 1]
}

function addLink(node, row = null) {
  const destination = row || ensureButtonRow(node)
  if (destination.length >= 4) return
  destination.push(createTelegramButton('url'))
}

function addSubmenu(node, row = null) {
  if (draft.value.nodes.length >= 30) return
  const destination = row || ensureButtonRow(node)
  if (destination.length >= 4) return
  const child = createTelegramMenuNode({ parentId: node.id, title: `Submenu ${draft.value.nodes.length}` })
  draft.value.nodes.push(child)
  destination.push(createTelegramButton('submenu', { targetNodeId: child.id, label: child.title }))
  selectedNodeId.value = child.id
}

function addRow(node) {
  if (node.rows.length >= 8) return
  node.rows.push([createTelegramButton('url')])
}

function removeButton(node, rowIndex, buttonIndex) {
  const [button] = node.rows[rowIndex].splice(buttonIndex, 1)
  if (!node.rows[rowIndex].length) node.rows.splice(rowIndex, 1)
  if (button?.action === 'submenu') removePage(button.targetNodeId)
}

function removePage(nodeId) {
  if (!nodeId || nodeId === draft.value.rootNodeId) return
  const descendants = new Set([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of draft.value.nodes) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id)
        changed = true
      }
    }
  }
  draft.value.nodes = draft.value.nodes.filter((node) => !descendants.has(node.id))
  for (const node of draft.value.nodes) {
    node.rows = (node.rows || [])
      .map((row) => row.filter((button) => button.action !== 'submenu' || !descendants.has(button.targetNodeId)))
      .filter((row) => row.length)
  }
  selectedNodeId.value = draft.value.rootNodeId
}

function move(list, index, direction) {
  const target = index + direction
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
}
</script>

<template>
  <section class="telegram-builder">
    <div class="telegram-kind-grid">
      <button
        v-for="option in TELEGRAM_TEMPLATE_KIND_OPTIONS"
        :key="option.value"
        type="button"
        :class="['telegram-kind-card', { 'telegram-kind-card--active': draft.kind === option.value }]"
        @click="setKind(option.value)"
      >
        <q-icon :name="option.icon" size="27px" />
        <strong>{{ option.label }}</strong>
        <span>{{ option.description }}</span>
        <q-icon v-if="draft.kind === option.value" name="check_circle" class="kind-check" />
      </button>
    </div>

    <div v-if="draft.kind === 'text'" class="telegram-content-card">
      <div class="builder-copy"><strong>Mensagem simples</strong><span>O Telegram receberá texto literal; tags HTML não serão interpretadas.</span></div>
      <q-input v-model="draft.text" outlined stack-label type="textarea" autogrow maxlength="4096" counter label="Texto *" />
      <q-toggle v-model="draft.disableLinkPreview" label="Desativar prévia automática de links" color="primary" />
    </div>

    <div v-else-if="draft.kind === 'photo' || draft.kind === 'video'" class="telegram-content-card">
      <div class="builder-copy">
        <strong>{{ draft.kind === 'photo' ? 'Imagem por URL' : 'Vídeo MP4 por URL' }}</strong>
        <span>O servidor valida HTTPS, rede pública, tamanho e conteúdo real antes de enviar.</span>
      </div>
      <q-input v-model.trim="draft.mediaUrl" outlined stack-label label="URL HTTPS da mídia *" hint="Hosts locais, redes privadas e redirecionamentos inseguros são bloqueados">
        <template #prepend><q-icon name="https" color="primary" /></template>
      </q-input>
      <q-input v-model="draft.caption" outlined stack-label type="textarea" autogrow maxlength="1024" counter label="Legenda (opcional)" />
      <q-banner rounded class="media-security-note"><q-icon name="shield" class="q-mr-sm" />A mídia só é baixada no momento do primeiro envio e o file_id seguro do Telegram pode ser reutilizado.</q-banner>
    </div>

    <div v-else-if="draft.kind === 'menu'" class="menu-builder-grid">
      <aside class="menu-page-list">
        <div class="builder-copy"><strong>Páginas do fluxo</strong><span>{{ draft.nodes.length }}/30 páginas</span></div>
        <button
          v-for="node in draft.nodes"
          :key="node.id"
          type="button"
          :class="['menu-page-item', { 'menu-page-item--active': node.id === selectedNode?.id }]"
          @click="selectedNodeId = node.id"
        >
          <q-icon :name="node.id === draft.rootNodeId ? 'home' : 'subdirectory_arrow_right'" />
          <span><strong>{{ node.title || 'Sem título' }}</strong><small>{{ node.id === draft.rootNodeId ? 'Página inicial' : 'Submenu' }}</small></span>
        </button>
      </aside>

      <section v-if="selectedNode" class="menu-node-editor">
        <header class="menu-node-header">
          <div class="builder-copy"><strong>Editar página</strong><span>Os botões podem abrir um submenu ou um link externo.</span></div>
          <q-btn v-if="selectedNode.id !== draft.rootNodeId" flat round color="negative" icon="delete" aria-label="Remover página" @click="removePage(selectedNode.id)" />
        </header>
        <q-input v-model.trim="selectedNode.title" outlined stack-label maxlength="160" label="Título da página *" />
        <q-input v-model="selectedNode.text" outlined stack-label type="textarea" autogrow maxlength="3900" counter label="Texto da página" />

        <div class="menu-actions-toolbar">
          <strong>Botões</strong>
          <q-space />
          <q-btn flat dense color="primary" no-caps icon="add_link" label="Link" @click="addLink(selectedNode)" />
          <q-btn flat dense color="primary" no-caps icon="account_tree" label="Submenu" @click="addSubmenu(selectedNode)" />
          <q-btn outline dense color="primary" no-caps icon="view_week" label="Nova linha" @click="addRow(selectedNode)" />
        </div>

        <q-banner v-if="!selectedNode.rows.length" rounded class="empty-buttons-note">Adicione um link ou submenu. O botão “Voltar” aparece automaticamente nas páginas filhas.</q-banner>

        <article v-for="(row, rowIndex) in selectedNode.rows" :key="`row-${rowIndex}`" class="menu-button-row">
          <header>
            <span>Linha {{ rowIndex + 1 }}</span>
            <q-space />
            <q-btn flat round dense icon="arrow_upward" :disable="rowIndex === 0" @click="move(selectedNode.rows, rowIndex, -1)" />
            <q-btn flat round dense icon="arrow_downward" :disable="rowIndex === selectedNode.rows.length - 1" @click="move(selectedNode.rows, rowIndex, 1)" />
            <q-btn v-if="row.length < 4" flat round dense color="primary" icon="add_link" @click="addLink(selectedNode, row)" />
          </header>
          <div class="menu-buttons-grid">
            <div v-for="(button, buttonIndex) in row" :key="button.id" class="menu-button-card">
              <q-input v-model.trim="button.label" outlined dense stack-label maxlength="64" label="Texto do botão *" />
              <template v-if="button.action === 'url'">
                <q-input v-model.trim="button.url" outlined dense stack-label label="Link HTTPS *"><template #prepend><q-icon name="open_in_new" /></template></q-input>
              </template>
              <template v-else>
                <div class="submenu-target"><q-icon name="account_tree" /><span>Abre: <strong>{{ draft.nodes.find((node) => node.id === button.targetNodeId)?.title || 'Página removida' }}</strong></span></div>
              </template>
              <q-btn flat dense color="negative" no-caps icon="delete" label="Remover" @click="removeButton(selectedNode, rowIndex, buttonIndex)" />
            </div>
          </div>
        </article>
      </section>

      <aside v-if="selectedNode" class="telegram-phone-preview">
        <div class="preview-phone-title">Prévia da página</div>
        <div class="telegram-bubble">
          <strong>{{ selectedNode.title }}</strong>
          <p v-if="selectedNode.text">{{ selectedNode.text }}</p>
          <div v-for="(row, index) in previewButtons" :key="index" class="preview-button-row">
            <span v-for="button in row" :key="button.id">{{ button.label }}</span>
          </div>
        </div>
        <small>{{ telegramDefinitionBody(draft).length }} caracteres na página inicial</small>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.telegram-builder,
.telegram-content-card,
.menu-node-editor,
.menu-page-list {
  display: grid;
  gap: 16px;
}

.telegram-kind-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.telegram-kind-card {
  position: relative;
  display: grid;
  min-height: 142px;
  gap: 7px;
  padding: 16px;
  border: 1px solid rgba(3, 21, 21, .1);
  border-radius: 16px;
  background: rgba(255,255,255,.78);
  color: #49635e;
  cursor: pointer;
  text-align: left;
}

.telegram-kind-card strong { color: #173b35; font-size: .92rem; }
.telegram-kind-card span { font-size: .75rem; line-height: 1.4; }
.telegram-kind-card--active { border-color: #26ad96; background: rgba(74, 220, 193, .13); color: #147764; }
.kind-check { position: absolute; top: 10px; right: 10px; }

.telegram-content-card,
.menu-node-editor,
.menu-page-list,
.telegram-phone-preview {
  padding: 17px;
  border: 1px solid rgba(18, 104, 89, .14);
  border-radius: 17px;
  background: rgba(255,255,255,.82);
}

.builder-copy { display: grid; gap: 2px; }
.builder-copy strong { color: #183c35; }
.builder-copy span { color: #70847f; font-size: .78rem; }
.media-security-note,
.empty-buttons-note { background: rgba(75, 211, 185, .1); color: #42665f; font-size: .79rem; }

.menu-builder-grid { display: grid; grid-template-columns: 190px minmax(0, 1fr) 230px; gap: 14px; align-items: start; }
.menu-page-list { max-height: 670px; overflow: auto; }
.menu-page-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px; border: 0; border-radius: 11px; background: transparent; color: #526b66; cursor: pointer; text-align: left; }
.menu-page-item span { display: grid; min-width: 0; }
.menu-page-item strong { overflow: hidden; color: #244b44; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
.menu-page-item small { font-size: .68rem; }
.menu-page-item--active { background: rgba(39, 183, 159, .14); color: #147764; }
.menu-node-header,
.menu-actions-toolbar,
.menu-button-row > header,
.submenu-target { display: flex; align-items: center; gap: 8px; }
.menu-button-row { padding: 12px; border: 1px solid rgba(3,21,21,.08); border-radius: 13px; background: #f8fcfb; }
.menu-button-row > header { margin-bottom: 10px; color: #54706a; font-size: .75rem; font-weight: 800; }
.menu-buttons-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.menu-button-card { display: grid; gap: 8px; padding: 11px; border-radius: 11px; background: #fff; }
.submenu-target { min-height: 42px; padding: 8px; border-radius: 9px; background: rgba(39,183,159,.08); color: #42665f; font-size: .74rem; }
.telegram-phone-preview { position: sticky; top: 12px; background: #eaf7f4; }
.preview-phone-title { margin-bottom: 12px; color: #47665f; font-size: .72rem; font-weight: 800; text-transform: uppercase; }
.telegram-bubble { padding: 13px; border-radius: 14px 14px 5px 14px; background: #fff; color: #284740; box-shadow: 0 8px 20px rgba(27,92,80,.08); }
.telegram-bubble p { margin: 7px 0 12px; white-space: pre-wrap; }
.preview-button-row { display: flex; gap: 5px; margin-top: 5px; }
.preview-button-row span { flex: 1; padding: 7px 5px; border-radius: 7px; background: #e7f5f2; color: #16806d; font-size: .7rem; text-align: center; }
.telegram-phone-preview > small { display: block; margin-top: 9px; color: #67817b; }

@media (max-width: 1200px) {
  .telegram-kind-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .menu-builder-grid { grid-template-columns: 170px minmax(0, 1fr); }
  .telegram-phone-preview { display: none; }
}

@media (max-width: 700px) {
  .telegram-kind-grid,
  .menu-builder-grid,
  .menu-buttons-grid { grid-template-columns: 1fr; }
  .telegram-kind-card { min-height: 112px; }
  .menu-page-list { max-height: 230px; }
}
</style>
