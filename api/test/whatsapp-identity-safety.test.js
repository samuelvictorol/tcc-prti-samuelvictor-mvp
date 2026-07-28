const test = require('node:test');
const assert = require('node:assert/strict');
const Contact = require('../src/models/contact.model');
const contactsManager = require('../src/managers/contacts.manager');
const { encrypt, decrypt, searchHash } = require('../src/services/crypto.service');

function restoreAfter(context, entries) {
  const originals = entries.map(([target, key]) => [target, key, target[key]]);
  context.after(() => originals.forEach(([target, key, value]) => { target[key] = value; }));
}

// Fixture de compatibilidade: documentos criados por versões anteriores não
// são apagados durante a migração para o canal oficial.
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

test('migração legada recupera telefone real sem transformar LID em número', async (context) => {
  restoreAfter(context, [[Contact, 'find'], [Contact, 'exists']]);
  const contact = legacyLidContact();

  const serialized = contactsManager.serialize(contact);
  assert.equal(serialized.phone, '551131234567');
  assert.equal(serialized.phoneSource, 'verified_provider_identity');
  assert.deepEqual(serialized.channels, []);

  Contact.find = () => ({ select: async () => [contact] });
  Contact.exists = async () => null;
  const result = await contactsManager.repairLegacyWhatsappPhones();

  assert.deepEqual(result, { scanned: 1, repaired: 1, cleared: 0, conflicts: 0 });
  assert.equal(decrypt(contact.phoneEncrypted), '551131234567');
  assert.equal(contact.phoneHash, searchHash('551131234567'));
});

test('identidade sem wa_id sinaliza telefone ausente e Cloud recusa o destino', async (context) => {
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
