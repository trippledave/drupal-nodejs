/**
 * Submodule for handling communication with clients.
 */
'use strict';

var configManager = require('./config-manager');
var backend = require('./backend');

var settings = configManager.getSettings();

var clientManager = {
  io: null,
  authenticatedClients: {},
  sockets: {},
  onlineUsers: {},
  tokenChannels: {},
  presenceTimeoutIds: {},
  contentChannelTimeoutIds: {},
  channels: {}
};

clientManager.initSocketIo = function (io) {
  this.io = io;

  io.set('resource', settings.resource);
  io.set('transports', settings.transports);

  io.on('connection', function(socket) {
      clientManager.addSocket(socket);

      socket.on('authenticate', function(message) {
        clientManager.authenticateClient(socket, message);
      });

      socket.on('message', function(message) {
        clientManager.processMessage(socket.id, message);
      });

      socket.on('disconnect', function () {
        clientManager.cleanupSocket(socket);
      });
    })
    .on('error', function(exception) {
      console.log('Socket error [' + exception + ']');
    });
};

/**
 * Registers a socket.
 * @param socket
 */
clientManager.addSocket = function (socket) {
  process.emit('client-connection', socket.id);
  this.sockets[socket.id] = socket;
};

/**
 * Authenticate a client connection based on the message it sent.
 */
clientManager.authenticateClient = function (client, message) {
  if (settings.debug) {
    console.log('Authenticating client with key "' + message.authToken + '"');
  }

  // If the authToken is verified, initiate a connection with the client.
  if (this.authenticatedClients[message.authToken]) {
    if (settings.debug) {
      console.log('Reusing existing authentication data for key:', message.authToken, ', client id:', client.id);
    }
    this.setupClientConnection(client.id, this.authenticatedClients[message.authToken], message.contentTokens);
  }
  else {
    message.messageType = 'authenticate';
    message.clientId = client.id;
    backend.sendMessageToBackend(message, this.authenticateClientCallback);
  }
};

clientManager.processMessage = function (socketId, message) {
  // If the message is from an active client, then process it.
  if (this.sockets[socketId] && message.hasOwnProperty('type')) {
    if (settings.debug) {
      console.log('Received message from client ' + socketId);
    }

    // If this message is destined for a channel, check two things:
    // - that this channel is allowed to get messages directly from clients
    // - that the sending socket is already in this channel (that is, the
    // backend has sent this channel in this user's allowed list).
    // Do not let extensions using this feature accidentally allow sending
    // of messages to any socket on any channel.
    if (message.hasOwnProperty('channel')) {
      if (this.channelIsClientWritable(message.channel) && this.clientIsInChannel(socketId, message.channel)) {
        process.emit('client-to-channel-message', socketId, message);
      }
      else if (settings.debug) {
        console.log('Received unauthorised message from client: cannot write to channel ' + socketId);
      }
    }

    // No channel, so this message is destined for one or more clients. Check
    // that this is allowed in the server configuration.
    else if (settings.clientsCanWriteToClients) {
      process.emit('client-to-client-message', socketId, message);
    }
    else if (settings.debug) {
      console.log('Received unauthorised message from client: cannot write to client ' + socketId);
    }
  }
};
/**
 * Cleanup after a socket has disconnected.
 */
clientManager.cleanupSocket = function (socket) {
  process.emit('client-disconnect', socket.id);

  if (settings.debug) {
    console.log("Cleaning up after socket id", socket.id, 'uid', socket.uid);
  }

  for (var channel in this.channels) {
    delete this.channels[channel].sessionIds[socket.id];
  }

  var uid = socket.uid;
  if (uid != 0) {
    if (this.presenceTimeoutIds[uid]) {
      clearTimeout(this.presenceTimeoutIds[uid]);
    }

    this.presenceTimeoutIds[uid] = setTimeout(this.checkOnlineStatus, 2000, uid);
  }

  for (var tokenChannel in this.tokenChannels) {
    console.log("cleanupSocket: checking tokenChannel", tokenChannel, socket.id);

    if (this.tokenChannels[tokenChannel].sockets[socket.id]) {
      console.log("cleanupSocket: found socket.id for tokenChannel", tokenChannel, this.tokenChannels[tokenChannel].sockets[socket.id]);

      if (this.tokenChannels[tokenChannel].sockets[socket.id].notifyOnDisconnect) {
        if (this.contentChannelTimeoutIds[tokenChannel + '_' + uid]) {
          clearTimeout(this.contentChannelTimeoutIds[tokenChannel + '_' + uid]);
        }

        this.contentChannelTimeoutIds[tokenChannel + '_' + uid] = setTimeout(this.checkTokenChannelStatus, 2000, tokenChannel, socket);
      }
      delete this.tokenChannels[tokenChannel].sockets[socket.id];
    }
  }

  delete this.sockets[socket.id];
};

module.exports = clientManager;
