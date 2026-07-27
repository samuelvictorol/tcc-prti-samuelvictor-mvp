const test = require('node:test');
const assert = require('node:assert/strict');
const Contact = require('../src/models/contact.model');
const contactsManager = require('../src/managers/contacts.manager');
const whatsappWebManager = require('../src/managers/whatsapp-web.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const { encrypt, decrypt, searchHash } = require('../src/services/crypto.service');

function restoreAfter(context, entries) {
  const originals = entries.map(([target, key]) => [target, key, target[key]]);
  context.after(() => originals.forEach(([target, key, value]) => { target[key] = value; }));
}

function legacyLidContact() {
  return {
    _id: '507f1f77bcf86cd799439011',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameSource: 'whatsapp_web',
    phoneEncrypted: encrypt('123456789012345'),
    phoneHash: searchHash('123456789012345'),
    active: true,
    notificationDisabled: false,
    deletedAt: null,
    channels: [{
      _id: '507f1f77bcf86cd799439012',
      channel: 'whatsapp_web',
      addressEncrypted: encrypt('123456789012345@lid'),
      addressHash: searchHash('123456789012345@lid'),
      authorized: true,
      consentStatus: 'granted',
      metadataEncrypted: encrypt({
        chatId: '123456789012345@lid',
        contactId: '551131234567@c.us',
        serializedId: '551131234567@c.us',
        contactUser: '551131234567',
        contactNumber: '123456789012345'
      })
    }],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    save: async () => undefined
  };
}

test('serializacao e migracao recuperam telefone real sem transformar LID em numero', async (context) => {
  restoreAfter(context, [[Contact, 'find'], [Contact, 'exists']]);
  const contact = legacyLidContact();

  const serialized = contactsManager.serialize(contact);
  assert.equal(serialized.phone, '551131234567');
  assert.equal(serialized.phoneSource, 'verified_provider_identity');
  assert.equal(serialized.channels[0].address, '123456789012345@lid');

  Contact.find = () => ({ select: async () => [contact] });
  Contact.exists = async () => null;
  const result = await contactsManager.repairLegacyWhatsappPhones();

  assert.deepEqual(result, { scanned: 1, repaired: 1, cleared: 0, conflicts: 0 });
  assert.equal(decrypt(contact.phoneEncrypted), '551131234567');
  assert.equal(contact.phoneHash, searchHash('551131234567'));
});

test('identidade sem wa_id ou @c.us sinaliza telefone ausente e Cloud recusa o destino', async (context) => {
  restoreAfter(context, [[Contact, 'findById']]);
  const contact = legacyLidContact();
  contact.channels = [{
    _id: '507f1f77bcf86cd799439013',
    channel: 'whatsapp_cloud',
    addressEncrypted: encrypt('123456789012345'),
    addressHash: searchHash('123456789012345'),
    authorized: true,
    consentStatus: 'granted',
    metadataEncrypted: encrypt({ fromLogicalId: '123456789012345', userId: 'BR.123456789012345' })
  }];
  Contact.findById = () => ({ select: async () => contact });

  const serialized = contactsManager.serialize(contact);
  assert.equal(serialized.phone, null);
  assert.equal(serialized.phoneUnavailableReason, 'PROVIDER_IDENTIFIER_IS_NOT_PHONE');
  assert.equal(serialized.channels[0].deliveryAddress, null);
  await assert.rejects(
    () => contactsManager.getDestination(contact._id, 'whatsapp_cloud'),
    (error) => error.code === 'WHATSAPP_PHONE_UNAVAILABLE'
  );
});

test('WhatsApp Web prioriza id @c.us e rejeita contactData.number quando ele e o LID', () => {
  const real = whatsappWebManager.verifiedContactPhone(
    {},
    {
      id: { _serialized: '551131234567@c.us', user: '551131234567', server: 'c.us' },
      number: '123456789012345'
    },
    '123456789012345@lid',
    '551131234567@c.us'
  );
  assert.equal(real, '551131234567');
  assert.equal(whatsappWebManager.verifiedContactPhone(
    {},
    { id: { _serialized: '123456789012345@lid' }, number: '123456789012345' },
    '123456789012345@lid',
    '123456789012345@lid'
  ), null);
});

test('Cloud usa somente from/wa_id como telefone e correlaciona from_logical_id ao chat Web', async (context) => {
  restoreAfter(context, [
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel']
  ]);
  assert.equal(whatsappCloudManager.cloudIdentity({ user_id: 'BR.12345678901234567' }), null);
  assert.equal(whatsappCloudManager.cloudIdentity({ from_logical_id: '123456789012345' }), null);
  assert.equal(whatsappCloudManager.cloudIdentity({ from: '551131234567' }), '551131234567');

  const lookups = [];
  contactsManager.findByChannelAddress = async (channel, address) => {
    lookups.push([channel, address]);
    if (channel === 'whatsapp_web' && address === '123456789012345@lid') {
      return { id: '507f1f77bcf86cd799439011', channels: [] };
    }
    return null;
  };
  contactsManager.findByChannelOrPhone = async () => {
    throw new Error('nao deve procurar outro contato depois do match por logical id');
  };
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return {
      id: input.matchedContactId,
      displayName: 'Samuel',
      channels: [{ channel: 'whatsapp_cloud', authorized: false, consentStatus: 'unknown' }],
      upsertState: { created: false, identityAdded: true }
    };
  };

  const result = await whatsappCloudManager.upsertCloudContact({
    from: '551131234567',
    from_user_id: 'BR.12345678901234567',
    from_logical_id: '123456789012345',
    type: 'text'
  }, { metadata: {} });

  assert.ok(lookups.some(([channel, address]) => channel === 'whatsapp_web' && address === '123456789012345@lid'));
  assert.equal(upsertInput.matchedContactId, '507f1f77bcf86cd799439011');
  assert.equal(upsertInput.phone, '551131234567');
  assert.equal(upsertInput.address, '551131234567');
  assert.equal(result.created, false);
});
