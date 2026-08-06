import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  normalizeTelegramWebhookActivity,
  telegramWebhookActivityPresentation,
} from '../src/pages/TelegramPage.vue'

const pageSource = readFileSync(
  fileURLToPath(new URL('../src/pages/TelegramPage.vue', import.meta.url)),
  'utf8',
)

describe('aba Webhook do Telegram', () => {
  it('mantém a ordem solicitada das abas e concentra o histórico na aba Webhook', () => {
    const broadcast = pageSource.indexOf('name="broadcast" icon="campaign"')
    const chats = pageSource.indexOf('name="chats" icon="forum"')
    const groups = pageSource.indexOf('name="groups" icon="groups"')
    const webhook = pageSource.indexOf('name="webhook" icon="webhook"')

    expect(broadcast).toBeGreaterThan(-1)
    expect(broadcast).toBeLessThan(chats)
    expect(chats).toBeLessThan(groups)
    expect(groups).toBeLessThan(webhook)
    expect(pageSource).toContain('<q-tab-panel name="webhook"')
    expect(pageSource).toContain('Webhook do Telegram')
    expect(pageSource).toContain('Ver detalhes do evento')
    expect(pageSource).not.toContain('<h3 class="section-title">Logs da fila</h3>')
  })

  it('mantém ignorados e falhas na aba Webhook e inicia as tabelas com 10 registros', () => {
    const broadcastStart = pageSource.indexOf('<q-tab-panel name="broadcast"')
    const chatsStart = pageSource.indexOf('<q-tab-panel name="chats"')
    const webhookStart = pageSource.indexOf('<q-tab-panel name="webhook"')
    const webhookEnd = pageSource.indexOf('</q-tab-panel>', webhookStart)
    const broadcastPanel = pageSource.slice(broadcastStart, chatsStart)
    const webhookPanel = pageSource.slice(webhookStart, webhookEnd)

    expect(broadcastPanel).not.toContain('Ignorados e falhas')
    expect(webhookPanel).toContain('Ignorados e falhas')
    expect(webhookPanel).toContain('v-model:pagination="webhookPagination"')
    expect(webhookPanel).toContain('v-model:pagination="issuePagination"')
    expect(pageSource).toContain("const webhookPagination = ref({ page: 1, rowsPerPage: 10 })")
    expect(pageSource).toContain("const issuePagination = ref({ page: 1, rowsPerPage: 10, rowsNumber: 0 })")
    expect(pageSource).toContain("tab.value = 'webhook'")
  })

  it('combina eventos em tempo real e logs persistentes em ordem decrescente', () => {
    const rows = normalizeTelegramWebhookActivity(
      [{ id: 'log-1', channel: 'telegram', action: 'message.received', createdAt: '2026-08-06T12:00:00.000Z' }],
      [{ updateId: 42, kind: 'message', at: '2026-08-06T12:01:00.000Z' }],
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source: 'webhook', updateId: 42, action: 'webhook.message' })
    expect(rows[1]).toMatchObject({ source: 'log', action: 'message.received' })
  })

  it('apresenta mensagens, callbacks e falhas com rótulos seguros', () => {
    expect(telegramWebhookActivityPresentation({ source: 'webhook', kind: 'message' }))
      .toMatchObject({ label: 'Atualização recebida', status: 'recebido', color: 'info' })
    expect(telegramWebhookActivityPresentation({ source: 'webhook', kind: 'menu_callback' }))
      .toMatchObject({ label: 'Interação com menu', status: 'processado', color: 'positive' })
    expect(telegramWebhookActivityPresentation({ source: 'log', action: 'notification.failed', level: 'error' }))
      .toMatchObject({ label: 'Falha no disparo', status: 'falhou', color: 'negative' })
  })
})
