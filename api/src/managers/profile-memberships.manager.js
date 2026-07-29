const mongoose = require('mongoose');
const Contact = require('../models/contact.model');
const ContactGroup = require('../models/contact-group.model');
const Log = require('../models/log.model');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const { searchHash } = require('../services/crypto.service');
const ApiError = require('../utils/api-error');

const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function objectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

function maskMemberPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'Não informado';
  if (digits.length <= 4) return '•'.repeat(digits.length);
  const visibleLength = Math.min(4, Math.max(2, digits.length - 4));
  return `${digits.slice(0, visibleLength)} ${'•'.repeat(digits.length - visibleLength)}`;
}

function membershipGroupSummary(group) {
  const serialized = groupsManager.serialize(group);
  return {
    id: serialized.id,
    name: serialized.name,
    description: serialized.description,
    source: serialized.source,
    sourceInvite: serialized.sourceInvite,
    memberCount: serialized.contactCount,
    active: serialized.active,
    notificationDisabled: serialized.notificationDisabled,
    updatedAt: serialized.updatedAt
  };
}

function membershipInviteSummary(origin) {
  return {
    id: String(origin.inviteId || origin.invite?._id || origin.invite),
    title: origin.title,
    slug: origin.slug,
    channels: [...new Set(origin.channels || [])],
    firstUsedAt: origin.firstUsedAt,
    lastUsedAt: origin.lastUsedAt
  };
}

function contactPhone(contact) {
  if (contact.phone) return contact.phone;
  return (contact.channels || [])
    .filter((identity) => identity.channel === 'whatsapp_cloud')
    .map((identity) => identity.deliveryAddress || identity.address)
    .find(Boolean);
}

async function createTransactionalAudit(input, session) {
  const document = {
    level: 'info',
    channel: 'privacy',
    action: input.action,
    message: input.message,
    actor: input.actorId,
    requestId: input.requestId,
    context: {
      contactReferenceHash: searchHash(String(input.contactId)),
      ...(input.groupId
        ? { groupReferenceHash: searchHash(String(input.groupId)) }
        : {}),
      ...(input.inviteId
        ? { inviteReferenceHash: searchHash(String(input.inviteId)) }
        : {}),
      source: input.source,
      selfService: Boolean(input.selfService),
      confirmed: true
    },
    retentionUntil: new Date(Date.now() + AUDIT_RETENTION_MS)
  };
  if (session) await Log.create([document], { session });
  else await Log.create(document);
}

function transactionUnavailable(error) {
  return [20, 263].includes(Number(error?.code))
    || /transaction numbers are only allowed|transactions are not supported|replica set/i
      .test(String(error?.message || ''));
}

function sessionOptions(session) {
  return session ? { session } : {};
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function withOptionalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let output;
    try {
      await session.withTransaction(async () => {
        output = await work(session);
      });
      return output;
    } catch (error) {
      if (!transactionUnavailable(error)) throw error;
      // O Docker local usa Mongo standalone. Nesse ambiente, a primeira
      // operação transacional é rejeitada antes de qualquer escrita. Repetimos
      // com operações condicionais/idempotentes e compensação explícita.
      return work(null);
    }
  } finally {
    await session.endSession();
  }
}

async function listOwn(contactId) {
  const contact = await contactsManager.getById(contactId);
  const groups = await ContactGroup.find({
    contacts: objectId(contactId)
  }).select(groupsManager.SECRET_SELECT).sort({ updatedAt: -1 });
  return {
    invites: (contact.inviteOrigins || []).map(membershipInviteSummary),
    groups: groups.map(membershipGroupSummary)
  };
}

async function ownGroupDetails(contactId, groupId) {
  const contactObjectId = objectId(contactId);
  const group = await ContactGroup.findOne({
    _id: objectId(groupId),
    contacts: contactObjectId
  }).select(groupsManager.SECRET_SELECT);
  if (!group) {
    throw new ApiError(
      404,
      'Grupo não encontrado entre os seus vínculos',
      null,
      'PROFILE_GROUP_MEMBERSHIP_NOT_FOUND'
    );
  }

  const members = await Contact.find({
    _id: { $in: group.contacts || [] },
    active: true,
    deletedAt: null
  }).select(contactsManager.SECRET_SELECT);
  const publicMembers = members
    .map((member) => contactsManager.serialize(member, { includeInlineAvatar: false }))
    .map((member) => ({
      displayName: member.displayName,
      phoneMasked: maskMemberPhone(contactPhone(member)),
      isSelf: String(member.id) === String(contactId)
    }))
    .sort((left, right) => String(left.displayName || '').localeCompare(
      String(right.displayName || ''),
      'pt-BR'
    ));

  return {
    ...membershipGroupSummary(group),
    members: publicMembers
  };
}

async function removeOwnGroupMembership(contactId, groupId, meta = {}) {
  return withOptionalTransaction(async (session) => {
    const contactObjectId = objectId(contactId);
    const groupObjectId = objectId(groupId);
    const groupQuery = ContactGroup.findOne({
      _id: groupObjectId,
      contacts: contactObjectId
    }).select(groupsManager.SECRET_SELECT);
    const selectedGroup = await withSession(groupQuery, session);
    if (!selectedGroup) {
      throw new ApiError(
        404,
        'Você não participa deste grupo',
        null,
        'PROFILE_GROUP_MEMBERSHIP_NOT_FOUND'
      );
    }

    const result = await ContactGroup.updateOne(
      { _id: groupObjectId, contacts: contactObjectId },
      { $pull: { contacts: contactObjectId } },
      sessionOptions(session)
    );
    if (!result.modifiedCount) {
      throw new ApiError(
        409,
        'O vínculo com o grupo já foi alterado',
        null,
        'PROFILE_GROUP_MEMBERSHIP_CHANGED'
      );
    }
    let auditRecorded = true;
    try {
      await createTransactionalAudit({
        action: 'profile.group_membership_removed',
        message: 'Contato removeu o próprio vínculo com um grupo',
        contactId,
        groupId,
        requestId: meta.requestId,
        source: 'profile_self_service',
        selfService: true
      }, session);
    } catch (error) {
      if (session) throw error;
      auditRecorded = false;
    }
    return {
      id: String(groupId),
      name: groupsManager.serialize(selectedGroup).name,
      removed: true,
      auditRecorded
    };
  });
}

async function removeInviteMembership(contactId, inviteId, meta = {}) {
  return withOptionalTransaction(async (session) => {
    const contactObjectId = objectId(contactId);
    const inviteObjectId = objectId(inviteId);
    const contactQuery = Contact.findOne({
      _id: contactObjectId,
      active: true,
      deletedAt: null,
      'inviteOrigins.invite': inviteObjectId
    }).select('inviteOrigins');
    const contact = await withSession(contactQuery, session);
    if (!contact) {
      throw new ApiError(
        404,
        'Convite não encontrado entre os vínculos deste contato',
        null,
        'CONTACT_INVITE_MEMBERSHIP_NOT_FOUND'
      );
    }
    const origin = (contact.inviteOrigins || []).find(
      (item) => String(item.invite?._id || item.invite) === String(inviteId)
    );

    const affectedGroups = session
      ? []
      : await ContactGroup.find({
          sourceInvite: inviteObjectId,
          contacts: contactObjectId
        }).select('_id').lean();
    let groupsUpdate;
    try {
      groupsUpdate = await ContactGroup.updateMany(
        {
          sourceInvite: inviteObjectId,
          contacts: contactObjectId
        },
        { $pull: { contacts: contactObjectId } },
        sessionOptions(session)
      );
      const contactUpdate = await Contact.updateOne(
        {
          _id: contactObjectId,
          'inviteOrigins.invite': inviteObjectId
        },
        { $pull: { inviteOrigins: { invite: inviteObjectId } } },
        sessionOptions(session)
      );
      if (!contactUpdate.modifiedCount) {
        throw new ApiError(
          409,
          'O vínculo com o convite já foi alterado',
          null,
          'CONTACT_INVITE_MEMBERSHIP_CHANGED'
        );
      }
    } catch (error) {
      if (!session && affectedGroups.length) {
        await ContactGroup.updateMany(
          { _id: { $in: affectedGroups.map((group) => group._id) } },
          { $addToSet: { contacts: contactObjectId } }
        ).catch(() => undefined);
      }
      throw error;
    }
    let auditRecorded = true;
    try {
      await createTransactionalAudit({
        action: meta.selfService
          ? 'profile.invite_membership_removed'
          : 'contact.invite_membership_removed',
        message: meta.selfService
          ? 'Contato removeu o próprio vínculo com um convite'
          : 'Administrador removeu um vínculo de convite do contato',
        contactId,
        inviteId,
        actorId: meta.actorId,
        requestId: meta.requestId,
        source: meta.source || (meta.selfService ? 'profile_self_service' : 'admin_contact_dialog'),
        selfService: Boolean(meta.selfService)
      }, session);
    } catch (error) {
      if (session) throw error;
      auditRecorded = false;
    }

    return {
      id: String(inviteId),
      title: origin?.title || null,
      slug: origin?.slug || null,
      removed: true,
      synchronizedGroupsUpdated: Number(groupsUpdate.modifiedCount || 0),
      auditRecorded
    };
  });
}

module.exports = {
  listOwn,
  ownGroupDetails,
  removeOwnGroupMembership,
  removeInviteMembership,
  maskMemberPhone,
  membershipGroupSummary
};
