const SOUND_FILES = Object.freeze({
  notify: '/notify.mp3',
  whatsapp: '/whatsapp.mp3',
  telegram: '/telegram.mp3',
})

const audioInstances = new Map()
const pendingSounds = new Set()
let unlockListenersInstalled = false

function audioInstance(name) {
  if (typeof Audio === 'undefined') return null
  if (!audioInstances.has(name)) {
    const audio = new Audio(SOUND_FILES[name])
    audio.preload = 'auto'
    audio.volume = 0.72
    audioInstances.set(name, audio)
  }
  return audioInstances.get(name)
}

function removeUnlockListeners() {
  if (!unlockListenersInstalled || typeof window === 'undefined') return
  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    window.removeEventListener(eventName, unlockPendingSounds)
  }
  unlockListenersInstalled = false
}

async function unlockPendingSounds() {
  const names = [...pendingSounds]
  pendingSounds.clear()
  removeUnlockListeners()
  for (const name of names) {
    await playAppSound(name, { queueWhenBlocked: false })
  }
}

function installUnlockListeners() {
  if (unlockListenersInstalled || typeof window === 'undefined') return
  unlockListenersInstalled = true
  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(eventName, unlockPendingSounds, { once: true, passive: true })
  }
}

export async function playAppSound(name, { queueWhenBlocked = true } = {}) {
  if (!SOUND_FILES[name]) return false
  const audio = audioInstance(name)
  if (!audio) return false

  try {
    audio.currentTime = 0
    await audio.play()
    pendingSounds.delete(name)
    return true
  } catch (error) {
    // Navegadores podem bloquear áudio antes da primeira interação. Nesse caso,
    // guardamos apenas um toque de cada tipo e tentamos novamente depois do gesto.
    if (queueWhenBlocked && String(error?.name || '').toLowerCase() === 'notallowederror') {
      pendingSounds.add(name)
      installUnlockListeners()
    }
    return false
  }
}

export function soundFile(name) {
  return SOUND_FILES[name] || null
}

export function resetAppSoundsForTests() {
  pendingSounds.clear()
  audioInstances.clear()
  removeUnlockListeners()
}
