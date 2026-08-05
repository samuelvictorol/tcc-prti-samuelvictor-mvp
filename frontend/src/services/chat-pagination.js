export const CHAT_MESSAGE_PAGE_SIZE = 10
export const CHAT_SCROLL_TOP_THRESHOLD = 24
export const CHAT_SCROLL_BOTTOM_THRESHOLD = 80

export function shouldLoadOlderChatMessages({
  scrollTop,
  hasMore,
  loading,
  threshold = CHAT_SCROLL_TOP_THRESHOLD,
} = {}) {
  return Boolean(hasMore && !loading && Number(scrollTop || 0) <= Number(threshold || 0))
}

export function chatPageHasMore(payload = {}, requestedPage = 1, receivedCount = 0, pageSize = CHAT_MESSAGE_PAGE_SIZE) {
  const page = Math.max(1, Number(payload.page || requestedPage) || 1)
  const pages = Number(payload.pages)
  if (Number.isFinite(pages) && pages >= 0) return page < pages

  const total = Number(payload.total)
  if (Number.isFinite(total) && total >= 0) return page * pageSize < total

  return Number(receivedCount || 0) >= pageSize
}

export function preservedChatScrollTop({
  previousScrollTop = 0,
  previousScrollHeight = 0,
  nextScrollHeight = 0,
} = {}) {
  const heightDelta = Number(nextScrollHeight || 0) - Number(previousScrollHeight || 0)
  return Math.max(0, Number(previousScrollTop || 0) + heightDelta)
}

export function isNearChatBottom({
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  threshold = CHAT_SCROLL_BOTTOM_THRESHOLD,
} = {}) {
  const remaining = Number(scrollHeight || 0) - Number(clientHeight || 0) - Number(scrollTop || 0)
  return remaining <= Number(threshold || 0)
}

export function retainLoadedChatWindow(items = [], loadedPages = 1, pageSize = CHAT_MESSAGE_PAGE_SIZE) {
  const capacity = Math.max(1, Number(loadedPages || 1)) * Math.max(1, Number(pageSize || CHAT_MESSAGE_PAGE_SIZE))
  return items.length > capacity ? items.slice(-capacity) : items
}

export function chatWindowAfterRealtime(items = [], {
  loadedPages = 1,
  total = items.length,
  pageSize = CHAT_MESSAGE_PAGE_SIZE,
} = {}) {
  const pages = Math.max(1, Number(loadedPages || 1))
  const size = Math.max(1, Number(pageSize || CHAT_MESSAGE_PAGE_SIZE))
  const normalizedTotal = Math.max(items.length, Number(total || 0))
  return {
    items: retainLoadedChatWindow(items, pages, size),
    total: normalizedTotal,
    hasMore: normalizedTotal > pages * size,
  }
}
