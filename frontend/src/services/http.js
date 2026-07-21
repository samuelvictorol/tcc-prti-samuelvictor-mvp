import axios from 'axios'
import { clearStoredSession, getAccessToken, setAccessToken } from './tokens.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

let refreshRequest = null

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config
    const status = error.response?.status
    const isAuthRequest = /\/auth\/(login|refresh|logout)/.test(request?.url || '')

    if (status !== 401 || !request || request._retried || isAuthRequest) {
      return Promise.reject(error)
    }

    request._retried = true
    try {
      refreshRequest ??= axios
        .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
        .then((response) => response.data?.data?.accessToken || response.data?.accessToken || response.data?.token)
        .finally(() => {
          refreshRequest = null
        })

      const token = await refreshRequest
      if (!token) throw new Error('Refresh sem novo token')
      setAccessToken(token, Boolean(localStorage.getItem('notify.accessToken')))
      request.headers.Authorization = `Bearer ${token}`
      return http(request)
    } catch (refreshError) {
      clearStoredSession()
      window.dispatchEvent(new CustomEvent('auth:expired'))
      return Promise.reject(refreshError)
    }
  },
)

export function unwrap(response) {
  return response?.data?.data ?? response?.data ?? response
}

export function asList(payload, preferredKey) {
  const value = payload?.data ?? payload
  if (Array.isArray(value)) return value
  if (preferredKey && Array.isArray(value?.[preferredKey])) return value[preferredKey]
  return value?.items || value?.docs || value?.results || value?.rows || []
}

export function paginationOf(payload, fallback = {}) {
  const value = payload?.data ?? payload ?? {}
  const meta = value.pagination || value.meta || value
  return {
    page: Number(meta.page || meta.currentPage || fallback.page || 1),
    rowsPerPage: Number(meta.limit || meta.perPage || fallback.rowsPerPage || 10),
    rowsNumber: Number(meta.total || meta.totalItems || meta.count || fallback.rowsNumber || 0),
  }
}

export function errorMessage(error, fallback = 'Não foi possível concluir a operação.') {
  const details = error?.response?.data
  return details?.message || details?.error?.message || details?.error || error?.message || fallback
}

export async function fetchAll(path, options = {}) {
  const {
    params = {},
    preferredKey,
    limit = 100,
    maxPages = 50,
    maxItems = 5000,
  } = options
  const items = []
  const seen = new Set()
  let page = Number(params.page || 1)

  for (let requestNumber = 0; requestNumber < maxPages && items.length < maxItems; requestNumber += 1) {
    const payload = unwrap(await http.get(path, { params: { ...params, page, limit: Math.min(limit, 100) } }))
    const pageItems = asList(payload, preferredKey)
    let added = 0

    for (const item of pageItems) {
      const identity = item?.id || item?._id || item?.externalId || item?.chatId || JSON.stringify(item)
      if (seen.has(identity)) continue
      seen.add(identity)
      items.push(item)
      added += 1
      if (items.length >= maxItems) break
    }

    const pagination = paginationOf(payload, { page, rowsPerPage: Math.min(limit, 100), rowsNumber: 0 })
    const reachedTotal = pagination.rowsNumber > 0 && items.length >= pagination.rowsNumber
    if (!pageItems.length || pageItems.length < Math.min(limit, 100) || added === 0 || reachedTotal) break
    page += 1
  }

  return items
}
