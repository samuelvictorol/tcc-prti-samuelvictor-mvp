import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_NOTIFICATION_RETENTION_DAYS,
  buildAdminNotificationQuery,
  matchesAdminNotificationFilters,
  paginationAfterAdminNotificationRemoval,
  prependRealtimeAdminNotification,
} from '../src/services/admin-notifications.js'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('central de atualizações administrativas', () => {
  it('monta filtros paginados distinguindo lidas e não lidas', () => {
    expect(buildAdminNotificationQuery({
      search: '  Samuel ',
      read: 'unread',
      channel: 'telegram',
      kind: 'contact_auto_created',
    }, { page: 2, rowsPerPage: 15 })).toEqual({
      page: 2,
      limit: 15,
      search: 'Samuel',
      read: false,
      channel: 'telegram',
      kind: 'contact_auto_created',
    })

    expect(buildAdminNotificationQuery({
      read: 'read',
      channel: 'all',
      kind: 'all',
    }, {})).toMatchObject({ read: true, page: 1, limit: 15 })
    expect(ADMIN_NOTIFICATION_RETENTION_DAYS).toBe(30)
  })

  it('aplica os mesmos filtros aos eventos recebidos por websocket', () => {
    const item = {
      id: 'n1',
      title: 'Novo contato recebido',
      message: 'Samuel entrou pelo Telegram',
      channel: 'telegram',
      kind: 'contact_auto_created',
      read: false,
    }

    expect(matchesAdminNotificationFilters(item, {
      search: 'samuel',
      read: 'unread',
      channel: 'telegram',
      kind: 'contact_auto_created',
    })).toBe(true)
    expect(matchesAdminNotificationFilters(item, { read: 'read' })).toBe(false)
    expect(matchesAdminNotificationFilters(item, { channel: 'whatsapp_cloud' })).toBe(false)
    expect(prependRealtimeAdminNotification([{ ...item, title: 'antigo' }], item, 15)).toEqual([item])
  })

  it('recalcula e limita a página após remover uma notificação não lida', () => {
    expect(paginationAfterAdminNotificationRemoval({
      page: 3,
      rowsPerPage: 10,
      rowsNumber: 21,
      pages: 3,
    })).toEqual({
      pagination: {
        page: 2,
        rowsPerPage: 10,
        rowsNumber: 20,
        pages: 2,
      },
      pageChanged: true,
      shouldReload: true,
    })

    expect(paginationAfterAdminNotificationRemoval({
      page: 1,
      rowsPerPage: 15,
      rowsNumber: 1,
      pages: 1,
    })).toMatchObject({
      pagination: { page: 1, rowsNumber: 0, pages: 1 },
      pageChanged: false,
      shouldReload: false,
    })

    const layout = source('layouts/MainLayout.vue')
    expect(layout).toContain('paginationAfterAdminNotificationRemoval')
    expect(layout).toContain('if (next.shouldReload) void loadNotificationHistory()')
  })

  it('mantém o menu compacto e oferece histórico, detalhes e atualização sem limpar a lista', () => {
    const layout = source('layouts/MainLayout.vue')

    expect(layout).toContain('label="Ver todas"')
    expect(layout).toContain('v-model="notificationHistoryDialog"')
    expect(layout).toContain('Buscar por título ou mensagem')
    expect(layout).toContain('label="Leitura"')
    expect(layout).toContain('label="Canal"')
    expect(layout).toContain('label="Tipo"')
    expect(layout).toContain('showNotificationDetails(notification)')
    expect(layout).toContain('admin_notification:created')
    expect(layout).toContain('matchesAdminNotificationFilters')
    expect(layout).toContain('Mantém a última fotografia estável')
    expect(layout).toContain('notificationDetailsContext')
  })

  it('inclui a arte real da página Meu perfil na pasta pública', () => {
    const imagePath = fileURLToPath(new URL('../public/meuperfil.png', import.meta.url))
    expect(existsSync(imagePath)).toBe(true)
    expect(statSync(imagePath).size).toBeGreaterThan(1_000_000)
  })
})
