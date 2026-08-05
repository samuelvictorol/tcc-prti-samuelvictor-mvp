import { describe, expect, it } from 'vitest'
import {
  CHAT_MESSAGE_PAGE_SIZE,
  chatWindowAfterRealtime,
  chatPageHasMore,
  isNearChatBottom,
  preservedChatScrollTop,
  retainLoadedChatWindow,
  shouldLoadOlderChatMessages,
} from '../src/services/chat-pagination.js'

describe('paginação progressiva dos chats', () => {
  it('carrega o próximo bloco somente no topo do scroll do chat', () => {
    expect(CHAT_MESSAGE_PAGE_SIZE).toBe(10)
    expect(shouldLoadOlderChatMessages({ scrollTop: 0, hasMore: true, loading: false })).toBe(true)
    expect(shouldLoadOlderChatMessages({ scrollTop: 25, hasMore: true, loading: false })).toBe(false)
    expect(shouldLoadOlderChatMessages({ scrollTop: 0, hasMore: false, loading: false })).toBe(false)
    expect(shouldLoadOlderChatMessages({ scrollTop: 0, hasMore: true, loading: true })).toBe(false)
  })

  it('detecta páginas antigas pela resposta paginada da API', () => {
    expect(chatPageHasMore({ page: 1, pages: 3, total: 25 }, 1, 10)).toBe(true)
    expect(chatPageHasMore({ page: 3, pages: 3, total: 25 }, 3, 5)).toBe(false)
    expect(chatPageHasMore({ page: 1, total: 10 }, 1, 10)).toBe(false)
  })

  it('preserva a mensagem visível quando mensagens antigas são inseridas acima', () => {
    expect(preservedChatScrollTop({
      previousScrollTop: 8,
      previousScrollHeight: 600,
      nextScrollHeight: 1040,
    })).toBe(448)
    expect(preservedChatScrollTop({
      previousScrollTop: 40,
      previousScrollHeight: 600,
      nextScrollHeight: 580,
    })).toBe(20)
  })

  it('acompanha mensagens em tempo real apenas quando o usuário está perto do fim', () => {
    expect(isNearChatBottom({ scrollTop: 900, scrollHeight: 1200, clientHeight: 250 })).toBe(true)
    expect(isNearChatBottom({ scrollTop: 400, scrollHeight: 1200, clientHeight: 250 })).toBe(false)
  })

  it('mantém somente dez mensagens por bloco já carregado', () => {
    const items = Array.from({ length: 21 }, (_, index) => index + 1)
    expect(retainLoadedChatWindow(items, 1)).toEqual(items.slice(-10))
    expect(retainLoadedChatWindow(items, 2)).toEqual(items.slice(-20))
  })

  it('mantém dez visíveis e libera o histórico quando chega a décima primeira em tempo real', () => {
    const messages = Array.from({ length: 11 }, (_, index) => ({ id: index + 1 }))
    const result = chatWindowAfterRealtime(messages, { loadedPages: 1, total: 11 })

    expect(result.items).toEqual(messages.slice(-10))
    expect(result.total).toBe(11)
    expect(result.hasMore).toBe(true)
  })
})
