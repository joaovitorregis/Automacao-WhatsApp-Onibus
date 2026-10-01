'use strict';

// The current UI exposes the stanza ID, not necessarily the serialized library ID.
// Resolve only an exact, unique outgoing model; never guess a serialized ID.
function createAckReader(client) {
  return {
    async getMessageById(uiMessageId) {
      return client.pupPage.evaluate(uiId => {
        const collection = window.require('WAWebCollections').Msg;
        const models = collection.getModelsArray();
        const matches = models.filter(model => model.id?.fromMe === true
          && (model.id._serialized === uiId || model.id.id === uiId));
        if (matches.length !== 1) return null;
        const model = matches[0];
        const messageId = model.id._serialized || model.id.id;
        if (typeof messageId !== 'string' || !messageId) return null;
        return {
          uiMessageId: uiId,
          messageId,
          fromMe: model.id.fromMe,
          ack: model.ack,
          isSendFailure: model.isSendFailure === true
        };
      }, uiMessageId);
    }
  };
}

module.exports = { createAckReader };
