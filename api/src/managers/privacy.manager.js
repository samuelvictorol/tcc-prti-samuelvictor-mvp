const ContactGroup = require('../models/contact-group.model');
const ConsentEvent = require('../models/consent-event.model');
const InviteClick = require('../models/invite-click.model');
const Invite = require('../models/invite.model');
const Notification = require('../models/notification.model');
const contactsManager = require('./contacts.manager');

async function recordConsent(contactId, input, actorId) {
  const contact = await contactsManager.getById(contactId);
  const updatedContact = await contactsManager.setChannelConsent(contactId, input.channel, input.status, {
    legalBasis: input.legalBasis,
    purpose: input.purpose,
    source: 'admin_manual',
    termsVersion: input.termsVersion,
    actorId,
    evidence: { ...(input.evidence || {}), confirmed: input.confirmed === true }
  });
  const event = await ConsentEvent.findOne({ contact: contactId, channel: input.channel }).sort({ occurredAt: -1 }).select('-evidenceEncrypted').lean();
  return { contactId: contact.id, contact: updatedContact, consent: event, channelState: input.status };
}

async function exportContact(contactId) {
  const contact = await contactsManager.getById(contactId);
  const [groups, consents, clicks, notifications] = await Promise.all([
    ContactGroup.find({ contacts: contactId }).select('source createdAt').lean(),
    ConsentEvent.find({ contact: contactId }).select('-evidenceEncrypted').sort({ occurredAt: -1 }).lean(),
    InviteClick.find({ contact: contactId }).lean(),
    Notification.find({ $or: [{ recipientContacts: contactId }, { 'deliveries.contact': contactId }] }).select('kind channel status deliveries createdAt completedAt').lean()
  ]);
  return {
    generatedAt: new Date().toISOString(),
    contact,
    groups: groups.map((group) => ({ id: String(group._id), source: group.source, createdAt: group.createdAt })),
    consentHistory: consents,
    invitationClicks: clicks,
    notificationHistory: notifications.map((notification) => ({
      ...notification,
      deliveries: notification.deliveries.filter((delivery) => String(delivery.contact) === String(contactId))
    }))
  };
}

async function deleteContact(contactId) {
  await contactsManager.getById(contactId);
  await Promise.all([
    Notification.updateMany({ $or: [{ recipientContacts: contactId }, { 'deliveries.contact': contactId }] }, {
      $pull: { recipientContacts: contactId },
      $set: {
        'deliveries.$[delivery].status': 'skipped',
        'deliveries.$[delivery].errorCode': 'LGPD_DELETION',
        'deliveries.$[delivery].errorMessage': 'Contato excluido'
      }
    }, { arrayFilters: [{ 'delivery.contact': contactId, 'delivery.status': { $in: ['queued', 'processing'] } }] }),
    ConsentEvent.updateMany({ contact: contactId }, { $set: { contact: null } }),
    InviteClick.updateMany({ contact: contactId }, { $set: { contact: null } }),
    Invite.updateMany({ recipientContact: contactId }, { $set: { active: false }, $unset: { recipientContact: 1 } })
  ]);
  const removal = await contactsManager.remove(contactId);
  return {
    contactId: String(contactId),
    deleted: true,
    notificationEligibilityRevoked: true,
    auditEventsPseudonymized: true,
    personalArtifactsRemoved: true,
    removedConversations: removal.removedConversations || 0,
    removedConversationMessages: removal.removedConversationMessages || 0,
    removedAdminNotifications: removal.removedAdminNotifications || 0,
    sanitizedConversationShortcuts: removal.sanitizedConversationShortcuts || 0
  };
}

module.exports = { recordConsent, exportContact, deleteContact };
