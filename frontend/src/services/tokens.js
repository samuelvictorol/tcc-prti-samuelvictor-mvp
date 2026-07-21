const ACCESS_TOKEN_KEY = 'notify.accessToken'
const USER_KEY = 'notify.user'

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token, remember = false) {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  if (token) (remember ? localStorage : sessionStorage).setItem(ACCESS_TOKEN_KEY, token)
}

export function getStoredUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export function setStoredUser(user, remember = false) {
  sessionStorage.removeItem(USER_KEY)
  localStorage.removeItem(USER_KEY)
  if (user) (remember ? localStorage : sessionStorage).setItem(USER_KEY, JSON.stringify(user))
}

export function clearStoredSession() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
