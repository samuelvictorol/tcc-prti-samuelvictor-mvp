import { defineStore } from 'pinia'
import { http, unwrap } from '../services/http.js'

const aliases = {
  telegram: ['telegram'],
  whatsappCloud: ['whatsappCloud', 'whatsapp_cloud', 'whatsapp-cloud', 'meta'],
  email: ['email', 'gmail'],
}

function findChannel(status, channel) {
  for (const key of aliases[channel] || [channel]) {
    if (status?.[key] !== undefined) return status[key]
    if (status?.channels?.[key] !== undefined) return status.channels[key]
  }
  return undefined
}

export function channelValueIsEnabled(value) {
  if (typeof value === 'boolean') return value
  if (!value) return false
  return Boolean(value.enabled ?? value.configured ?? value.active ?? value.ready ?? value.status === 'ready')
}

export function invitesAreAvailable(status = {}) {
  return channelValueIsEnabled(findChannel(status, 'whatsappCloud'))
    && channelValueIsEnabled(findChannel(status, 'email'))
}

export const useAppStore = defineStore('app', {
  state: () => ({
    status: {},
    settings: {},
    loadingStatus: false,
    statusLoaded: false,
  }),
  getters: {
    isChannelEnabled: (state) => (channel) => {
      const value = findChannel(state.status, channel)
      return channelValueIsEnabled(value)
    },
    canAccessInvites: (state) => invitesAreAvailable(state.status),
    channelStatus: (state) => (channel) => findChannel(state.status, channel) || {},
  },
  actions: {
    async fetchStatus(force = false) {
      if (this.loadingStatus || (this.statusLoaded && !force)) return this.status
      this.loadingStatus = true
      try {
        this.status = unwrap(await http.get('/settings/status')) || {}
      } catch {
        try {
          const settings = unwrap(await http.get('/settings')) || {}
          this.settings = settings
          this.status = settings.status || settings.channels || {}
        } catch {
          this.status = {}
        }
      } finally {
        this.loadingStatus = false
        this.statusLoaded = true
      }
      return this.status
    },
    async fetchSettings() {
      this.settings = unwrap(await http.get('/settings')) || {}
      return this.settings
    },
    async saveSettings(settings) {
      const result = unwrap(await http.put('/settings', settings)) || settings
      this.settings = result.configuration || result.settings || result
      await this.fetchStatus(true)
      return result
    },
    updateChannelStatus(channel, value = {}) {
      const keys = aliases[channel] || [channel]
      const canonical = keys[0]
      this.status = {
        ...this.status,
        [canonical]: value,
        channels: {
          ...(this.status?.channels || {}),
          [canonical]: value,
        },
      }
      this.statusLoaded = true
      return value
    },
  },
})
