export const DEFAULT_WHATSAPP_PERMISSION_COMMAND = '/notify-me'

function valueOf(payload = {}) {
  return payload?.data?.data ?? payload?.data ?? payload ?? {}
}

export function whatsappPermissionCommandFromSettings(payload = {}) {
  const value = valueOf(payload)
  const configuration = value.configuration || value.settings || value
  const command = configuration.whatsappPermission?.command
    || configuration.whatsapp_permission?.command
    || configuration.whatsappCloud?.permissionCommand
    || configuration.whatsapp_cloud?.permissionCommand

  return String(command || DEFAULT_WHATSAPP_PERMISSION_COMMAND).trim() || DEFAULT_WHATSAPP_PERMISSION_COMMAND
}
