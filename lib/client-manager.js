/**
 * Submodule for handling communication with clients.
 */
'use strict';

/**
 * Constructor.
 */
function ClientManager(settings, backend) {
  this.settings = settings;
  this.backend = backend;
  this.authenticatedClients = {};
  this.sockets = {};
  this.onlineUsers = {};
  this.tokenChannels = {};
  this.presenceTimeoutIds = {},
  this.contentChannelTimeoutIds = {};
  this.channels =  {};
};

/**
 * Registers a socket in the internal store.
 * @param socket
 *   A socket object.
 */
ClientManager.prototype.addSocket = function (socket) {
  var thisClientManager = this;
  process.emit('client-connection', socket.id);

  socket.on('authenticate', function(message) {
    thisClientManager.authenticateClient(socket, message);
  });

  socket.on('message', function(message) {
    thisClientManager.processMessage(socket.id, message);
  });

  socket.on('disconnect', function () {
    thisClientManager.cleanupSocket(socket);
  });

  this.sockets[socket.id] = socket;
};

/**
 * Check if the given channel is client-writable.
 */
ClientManager.prototype.channelIsClientWritable = function (channel) {
  if (this.channels.hasOwnProperty(channel)) {
    return this.channels[channel].isClientWritable;
  }
  return false;
};

/**
 * Check if the given socket is in the given channel.
 */
ClientManager.prototype.clientIsInChannel = function (socketId, channel) {
  if (!this.channels.hasOwnProperty(channel)) {
    return false;
  }
  return this.channels[channel].sessionIds[socketId];
};

/**
 * Authenticate a client connection based on the message it sent.
 */
ClientManager.prototype.authenticateClient = function (client, message) {
  if (this.settings.debug) {
    console.log('Authenticating client with key "' + message.authToken + '"');
  }

  // If the authToken is verified, initiate a connection with the client.
  if (this.authenticatedClients[message.authToken]) {
    if (this.settings.debug) {
      console.log('Reusing existing authentication data for key:', message.authToken, ', client id:', client.id);
    }
    this.setupClientConnection(client.id, this.authenticatedClients[message.authToken], message.contentTokens);
  }
  else {
    message.messageType = 'authenticate';
    message.clientId = client.id;

    var thisClientManager = this;
    this.backend.sendMessageToBackend(message, function (error, response, body) {
      thisClientManager.authenticateClientCallback(error, response, body);
    });
  }
};

/**
 * Processes an incoming message event on the socket.
 * @param socketId
 *   The socket id that received the message.
 * @param message
 *   Arbitrary message object.
 */
ClientManager.prototype.processMessage = function (socketId, message) {
  // If the message is from an active client, then process it.
  if (this.sockets[socketId] && message.hasOwnProperty('type')) {
    if (this.settings.debug) {
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
      else if (this.settings.debug) {
        console.log('Received unauthorised message from client: cannot write to channel ' + socketId);
      }
    }

    // No channel, so this message is destined for one or more clients. Check
    // that this is allowed in the server configuration.
    else if (this.settings.clientsCanWriteToClients) {
      process.emit('client-to-client-message', socketId, message);
    }
    else if (this.settings.debug) {
      console.log('Received unauthorised message from client: cannot write to client ' + socketId);
    }
  }
};

/**
 * Handle authentication call response.
 */
ClientManager.prototype.authenticateClientCallback = function (error, response, body) {
  if (error) {
    console.log("Error with authenticate client request:", error);
    return;
  }
  if (response.statusCode == 404) {
    if (this.settings.debug) {
      console.log('Backend authentication url not found, full response info:', response);
    }
    else {
      console.log('Backend authentication url not found.');
    }
    return;
  }

  var authData = false;
  try {
    authData = JSON.parse(body);
  }
  catch (exception) {
    console.log('Failed to parse authentication message:', exception);
    if (this.settings.debug) {
      console.log('Failed message string: ' + body);
    }
    return;
  }

  if (!this.backend.checkServiceKey(authData.serviceKey)) {
    console.log('Invalid service key "', authData.serviceKey, '"');
    return;
  }

  if (authData.nodejsValidAuthToken) {
    if (this.settings.debug) {
      console.log('Valid login for uid "', authData.uid, '"');
    }
    this.setupClientConnection(authData.clientId, authData, authData.contentTokens);
    this.authenticatedClients[authData.authToken] = authData;
  }
  else {
    console.log('Invalid login for uid "', authData.uid, '"');
    delete this.authenticatedClients[authData.authToken];
  }
};

/**
 * Setup a sockets{}.connection with uid, channels etc.
 */
ClientManager.prototype.setupClientConnection = function (sessionId, authData, contentTokens) {
  if (!this.sockets[sessionId]) {
    console.log("Client socket '" + sessionId + "' went away.");
    return;
  }
  this.sockets[sessionId].authToken = authData.authToken;
  this.sockets[sessionId].uid = authData.uid;
  for (var i in authData.channels) {
    this.channels[authData.channels[i]] = this.channels[authData.channels[i]] || {'sessionIds': {}};
    this.channels[authData.channels[i]].sessionIds[sessionId] = sessionId;
  }
  if (authData.uid != 0) {
    var sendPresenceChange = !this.onlineUsers[authData.uid];
    this.onlineUsers[authData.uid] = authData.presenceUids || [];
    if (sendPresenceChange) {
      this.sendPresenceChangeNotification(authData.uid, 'online');
    }
  }

  var clientToken = '';
  for (var tokenChannel in contentTokens) {
    // @TODO: Need to check contentTokens.hasOwnProperty()?
    this.tokenChannels[tokenChannel] = this.tokenChannels[tokenChannel] || {'tokens': {}, 'sockets': {}};

    clientToken = contentTokens[tokenChannel];
    if (this.tokenChannels[tokenChannel].tokens[clientToken]) {
      this.tokenChannels[tokenChannel].sockets[sessionId] = this.tokenChannels[tokenChannel].tokens[clientToken];
      if (this.settings.debug) {
        console.log('Added token', clientToken, 'for channel', tokenChannel, 'for socket', sessionId);
      }
      delete this.tokenChannels[tokenChannel].tokens[clientToken];
    }
  }

  process.emit('client-authenticated', sessionId, authData);

  if (this.settings.debug) {
    console.log("Added channels for uid " + authData.uid + ': ' + authData.channels.toString());
    console.log('setupClientConnection', this.onlineUsers);
  }
};

/**
 * Send a presence notification for uid.
 */
ClientManager.prototype.sendPresenceChangeNotification = function (uid, presenceEvent) {
  if (this.onlineUsers[uid]) {
    for (var i in this.onlineUsers[uid]) {
      var sessionIds = this.getNodejsSessionIdsFromUid(this.onlineUsers[uid][i]);
      if (sessionIds.length > 0 && this.settings.debug) {
        console.log('Sending presence notification for', uid, 'to', this.onlineUsers[uid][i]);
      }
      for (var j in sessionIds) {
        this.sockets[sessionIds[j]].json.send({'presenceNotification': {'uid': uid, 'event': presenceEvent}});
      }
    }
  }
  if (this.settings.debug) {
    console.log('sendPresenceChangeNotification', uid, presenceEvent, this.onlineUsers);
  }
};

/**
 * Get the list of Node.js sessionIds for a given uid.
 */
ClientManager.prototype.getNodejsSessionIdsFromUid = function (uid) {
  var sessionIds = [];
  for (var sessionId in this.sockets) {
    if (this.sockets[sessionId].uid == uid) {
      sessionIds.push(sessionId);
    }
  }
  if (this.settings.debug) {
    console.log('getNodejsSessionIdsFromUid', {uid: uid, sessionIds: sessionIds});
  }
  return sessionIds;
};

/**
 * Cleanup after a socket has disconnected.
 */
ClientManager.prototype.cleanupSocket = function (socket) {
  process.emit('client-disconnect', socket.id);
  var thisClientManager = this;

  if (this.settings.debug) {
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

    this.presenceTimeoutIds[uid] = setTimeout(function () {
      thisClientManager.checkOnlineStatus(uid);
    }, 2000);
  }

  for (var tokenChannel in this.tokenChannels) {
    console.log("cleanupSocket: checking tokenChannel", tokenChannel, socket.id);

    if (this.tokenChannels[tokenChannel].sockets[socket.id]) {
      console.log("cleanupSocket: found socket.id for tokenChannel", tokenChannel, this.tokenChannels[tokenChannel].sockets[socket.id]);

      if (this.tokenChannels[tokenChannel].sockets[socket.id].notifyOnDisconnect) {
        if (this.contentChannelTimeoutIds[tokenChannel + '_' + uid]) {
          clearTimeout(this.contentChannelTimeoutIds[tokenChannel + '_' + uid]);
        }

        this.contentChannelTimeoutIds[tokenChannel + '_' + uid] = setTimeout(function () {
          thisClientManager.checkTokenChannelStatus(tokenChannel, socket);
        }, 2000);
      }
      delete this.tokenChannels[tokenChannel].sockets[socket.id];
    }
  }

  delete this.sockets[socket.id];
};

/**
 * Check for any open sockets for uid.
 */
ClientManager.prototype.checkOnlineStatus = function (uid) {
  if (this.getNodejsSessionIdsFromUid(uid).length == 0) {
    if (this.settings.debug) {
      console.log("Sending offline notification for", uid);
    }
    this.setUserOffline(uid);
  }
};

/**
 * Sends offline notification to sockets, the backend and cleans up our list.
 */
ClientManager.prototype.setUserOffline = function (uid) {
  this.sendPresenceChangeNotification(uid, 'offline');
  delete this.onlineUsers[uid];
  this.backend.sendMessageToBackend({uid: uid, messageType: 'userOffline'}, function (response) { });
};

/**
 * Kicks a user.
 */
ClientManager.prototype.kickUser = function (uid) {
  // Delete the user from the authenticatedClients hash.
  for (var authToken in this.authenticatedClients) {
    if (this.authenticatedClients[authToken].uid == uid) {
      delete this.authenticatedClients[authToken];
    }
  }

  // Destroy any socket connections associated with this uid.
  for (var clientId in this.sockets) {
    if (this.sockets[clientId].uid == uid) {
      // @TODO: Need to clean up event listeners on the socket? Or call .cleanupSocket? Note: similar situation in .logoutUser.
      delete this.sockets[clientId];

      if (this.settings.debug) {
        console.log('kickUser: deleted socket "' + clientId + '" for uid "' + uid + '"');
      }
      // Delete any channel entries for this clientId.
      for (var channel in this.channels) {
        delete this.channels[channel].sessionIds[clientId];
      }
    }
  }
};

/**
 * Add a user to a channel.
 * @return
 *   True on success, false if the client is not found.
 */
ClientManager.prototype.addUserToChannel = function (channel, uid) {
  this.channels[channel] = this.channels[channel] || {'sessionIds': {}};

  var sessionIds = this.getNodejsSessionIdsFromUid(uid);
  if (sessionIds.length > 0) {
    for (var i in sessionIds) {
      this.channels[channel].sessionIds[sessionIds[i]] = sessionIds[i];
    }
    if (this.settings.debug) {
      console.log("Added channel '" + channel + "' to sessionIds " + sessionIds.join());
    }
  }
  else {
    console.log("No active sessions for uid: " + uid);
    return false;
  }

  // @TODO: Does this need to run even when the client is not connected?
  // (authenticatedClients data will be reused when the connect.)
  for (var authToken in this.authenticatedClients) {
    if (this.authenticatedClients[authToken].uid == uid) {
      if (this.authenticatedClients[authToken].channels.indexOf(channel) == -1) {
        this.authenticatedClients[authToken].channels.push(channel);
        if (this.settings.debug) {
          console.log("Added channel '" + channel + "' authenticatedClients");
        }
      }
    }
  }

  return true;
};

/**
 * Get the list of Node.js sessionIds for a given authToken.
 */
ClientManager.prototype.getNodejsSessionIdsFromAuthToken = function (authToken) {
  var sessionIds = [];
  for (var sessionId in this.sockets) {
    if (this.sockets[sessionId].authToken == authToken) {
      sessionIds.push(sessionId);
    }
  }
  if (this.settings.debug) {
    console.log('getNodejsSessionIdsFromAuthToken', {authToken: authToken, sessionIds: sessionIds});
  }
  return sessionIds;
};

/**
 * Add an authToken to a channel.
 * @TODO Unused, needs testing.
 */
ClientManager.prototype.addAuthTokenToChannel = function (channel, authToken) {
  if (!this.authenticatedClients[authToken]) {
    console.log("Unknown authToken : " + authToken);
    return false;
  }

  this.channels[channel] = this.channels[channel] || {'sessionIds': {}};
  var sessionIds = this.getNodejsSessionIdsFromAuthToken(authToken);
  if (sessionIds.length > 0) {
    for (var i in sessionIds) {
      this.channels[channel].sessionIds[sessionIds[i]] = sessionIds[i];
    }
    if (this.settings.debug) {
      console.log("Added sessionIds '" + sessionIds.join() + "' to channel '" + channel + "'");
    }
  }
  else {
    console.log("No active sessions for authToken: " + authToken);
    return false;
  }

  if (this.authenticatedClients[authToken].channels.indexOf(channel) == -1) {
    this.authenticatedClients[authToken].channels.push(channel);
    if (this.settings.debug) {
      console.log("Added channel '" + channel + "' to authenticatedClients");
    }
  }

  return true;
};

/**
 * Remove an authToken from a channel.
 * @TODO Unused, needs testing.
 */
ClientManager.prototype.removeAuthTokenFromChannel = function (channel, authToken) {
  if (!this.authenticatedClients[authToken]) {
    console.log('Invalid authToken: ' + uid);
    return false;
  }
  if (this.channels[channel]) {
    var sessionIds = this.getNodejsSessionIdsFromAuthToken(authToken);
    for (var i in sessionIds) {
      if (this.channels[channel].sessionIds[sessionIds[i]]) {
        delete this.channels[channel].sessionIds[sessionIds[i]];
      }
    }

    if (this.authenticatedClients[authToken]) {
      var index = this.authenticatedClients[authToken].channels.indexOf(channel);
      if (index != -1) {
        delete this.authenticatedClients[authToken].channels[index];
      }
    }

    if (this.settings.debug) {
      console.log("Successfully removed authToken '" + authToken + "' from channel '" + channel + "'.");
    }
    return true;
  }
  else {
    console.log("Non-existent channel name '" + channel + "'");
    return false;
  }
};

/**
 * Add a client (specified by session ID) to a channel.
 * @TODO: Unused. Shall we keep it?
 */
ClientManager.prototype.addClientToChannel = function (sessionId, channel) {
  if (sessionId && channel) {
    if (!/^[0-9a-z_-]+$/i.test(sessionId) || !this.sockets.hasOwnProperty(sessionId)) {
      console.log("addClientToChannel: Invalid sessionId: " + sessionId);
    }
    else if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log("addClientToChannel: Invalid channel: " + channel);
    }
    else {
      this.channels[channel] = this.channels[channel] || {'sessionIds': {}};
      this.channels[channel].sessionIds[sessionId] = sessionId;
      if (this.settings.debug) {
        console.log("Added channel '" + channel + "' to sessionId " + sessionId);
      }
      return true;
    }
  }
  else {
    console.log("addClientToChannel: Missing sessionId or channel name");
  }
  return false;
};

/**
 * Remove a client (specified by session ID) from a channel.
 * @TODO: Unused. Shall we keep it?
 */
ClientManager.prototype.removeClientFromChannel = function (sessionId, channel) {
  if (sessionId && channel) {
    if (!/^[0-9a-z_-]+$/i.test(sessionId) || !this.sockets.hasOwnProperty(sessionId)) {
      console.log("removeClientFromChannel: Invalid sessionId: " + sessionId);
    }
    else if (!/^[a-z0-9_]+$/i.test(channel) || !this.channels.hasOwnProperty(channel)) {
      console.log("removeClientFromChannel: Invalid channel: " + channel);
    }
    else if (this.channels[channel].sessionIds[sessionId]) {
      delete this.channels[channel].sessionIds[sessionId];
      if (this.settings.debug) {
        console.log("Removed sessionId '" + sessionId + "' from channel '" + channel + "'");
      }
      return true;
    }
  }
  else {
    console.log("removeClientFromChannel: Missing sessionId or channel name");
  }
  return false;
};

/**
 * Remove a user from a channel.
 * @return
 *   True on success, false if the client is not found.
 */
ClientManager.prototype.removeUserFromChannel = function (channel, uid) {
  if (this.channels[channel]) {
    var sessionIds = this.getNodejsSessionIdsFromUid(uid);
    for (var i in sessionIds) {
      if (this.channels[channel].sessionIds[sessionIds[i]]) {
        delete this.channels[channel].sessionIds[sessionIds[i]];
      }
    }

    for (var authToken in this.authenticatedClients) {
      if (this.authenticatedClients[authToken].uid == uid) {
        var index = this.authenticatedClients[authToken].channels.indexOf(channel);
        if (index != -1) {
          delete this.authenticatedClients[authToken].channels[index];
        }
      }
    }

    if (this.settings.debug) {
      console.log("Successfully removed uid '" + uid + "' from channel '" + channel + "'");
    }

    return true;
  }
  else {
    console.log("Non-existent channel name '" + channel + "'");
    return false;
  }
};

/**
 * Add a channel.
 */
ClientManager.prototype.addChannel = function (channel) {
  if (this.channels[channel]) {
    console.log("Channel name '" + channel + "' already exists.");
    return false;
  }

  this.channels[channel] = {'sessionIds': {}};

  if (this.settings.debug) {
    console.log("Successfully added channel '" + channel + "'");
  }

  return true;
};

/**
 * Returns data for healthcheck purposes.
 */
ClientManager.prototype.getStats = function () {
  return {
    'authenticatedClients': Object.keys(this.authenticatedClients).length,
    'sockets': Object.keys(this.sockets).length,
    'onlineUsers': Object.keys(this.onlineUsers).length,
    'tokenChannels': Object.keys(this.tokenChannels).length,
    'contentTokens': this.tokenChannels
  }
};

/**
 * Checks whether a channel exists.
 * @param channel
 *   Channel name.
 * @return
 *   True on success false on error.
 */
ClientManager.prototype.checkChannel = function (channel) {
  if (this.channels[channel]) {
    console.log("Channel name '" + channel + "' is active on the server.");
    return true;
  }
  else {
    console.log("Channel name '" + channel + "' is not active on the server.");
    return false;
  }
};

/**
 * Remove a channel.
 * @param channel
 *   Channel name.
 * @return
 *   True on success false on error.
 */
ClientManager.prototype.removeChannel = function (channel) {
  if (this.channels[channel]) {
    delete this.channels[channel];
    if (this.settings.debug) {
      console.log("Successfully removed channel '" + channel + "'");
    }
    return true;
  }
  else {
    console.log("Non-existent channel name '" + channel + "'");
    return false;
  }
};

/**
 * Set the list of users a uid can see presence info about.
 */
ClientManager.prototype.setUserPresenceList = function (uid, uidlist) {
  for (var i in uidlist) {
    if (!/^\d+$/.test(uidlist[i])) {
      console.log("Invalid uid: " + uid);
      return false;
    }
  }
  this.onlineUsers[uid] = uidlist;
};

/**
 * Get the list of backend uids and authTokens connected to a content token channel.
 */
ClientManager.prototype.getContentTokenChannelUsers = function (channel) {
  var users = {uids: [], authTokens: []};

  if (!channel || !this.tokenChannels[channel]) {
    return users;
  }

  for (var sessionId in this.tokenChannels[channel].sockets) {
    if (this.sockets[sessionId].uid) {
      users.uids.push(this.sockets[sessionId].uid);
    }
    else {
      users.authTokens.push(this.sockets[sessionId].authToken);
    }
  }
  return users;
};

/**
 * Set a content token.
 */
ClientManager.prototype.setContentToken = function (channel, token, value) {
  this.tokenChannels[channel] = this.tokenChannels[channel] || {'tokens': {}, 'sockets': {}};
  this.tokenChannels[channel].tokens[token] = value;
};

/**
 * Publish a message to clients subscribed to a channel.
 * @return
 *   True on success; false on error.
 */
ClientManager.prototype.publishMessageToContentChannel = function (channel, message) {
  if (!this.tokenChannels.hasOwnProperty(channel)) {
    console.log('publishMessageToContentChannel: The channel "' + channel + '" doesn\'t exist.');
    return false;
  }

  for (var socketId in this.tokenChannels[channel].sockets) {
    this.publishMessageToClient(socketId, message);
  }
  return true;
};

/**
 * Logout the given user from the server.
 */
ClientManager.prototype.logoutUser = function (authToken) {
  // Delete the user from the authenticatedClients hash.
  delete this.authenticatedClients[authToken];

  // Destroy any socket connections associated with this authToken.
  for (var clientId in this.sockets) {
    if (this.sockets[clientId].authToken == authToken) {
      // @TODO: Ok to call cleanupSocket here? That method assumes the client has disconnected. Also, need to clean up
      // event listeners on the socket.
      this.cleanupSocket(this.sockets[clientId]);
    }
  }
};

/**
 * Check for any open sockets associated with the channel and socket pair.
 * @TODO: This function does not need the full socket object.
 */
ClientManager.prototype.checkTokenChannelStatus = function (tokenChannel, socket) {
  // If the tokenChannel no longer exists, just bail.
  if (!this.tokenChannels[tokenChannel]) {
    console.log("checkTokenChannelStatus: no tokenChannel", tokenChannel, socket.uid);
    return;
  }

  // If we find a socket for this user in the given tokenChannel, we can just
  // return, as there's nothing we need to do.
  var sessionIds = this.getNodejsSessionIdsFromUid(socket.uid);
  for (var i = 0; i < sessionIds.length; i++) {
    if (this.tokenChannels[tokenChannel].sockets[sessionIds[i]]) {
      console.log("checkTokenChannelStatus: found socket for tokenChannel", tokenChannel, socket.uid);
      return;
    }
  }

  // We didn't find a socket for this uid, and we have other sockets in this,
  // channel, so send disconnect notification message.
  var message = {
    'channel': tokenChannel,
    'contentChannelNotification': true,
    'data': {
      'uid': socket.uid,
      'type': 'disconnect',
    }
  };
  for (var socketId in this.tokenChannels[tokenChannel].sockets) {
    this.publishMessageToClient(socketId, message);
  }
};

/**
 * Publish a message to a specific client.
 */
ClientManager.prototype.publishMessageToClient = function (sessionId, message) {
  if (this.sockets[sessionId]) {
    this.sockets[sessionId].json.send(message);
    if (this.settings.debug) {
      console.log('Sent message to client ' + sessionId);
    }
    return true;
  }
  else {
    console.log('publishMessageToClient: Failed to find client ' + sessionId);
  }
};

/**
 * Publish a message to clients subscribed to a channel.
 */
ClientManager.prototype.publishMessageToChannel = function (message) {
  if (!message.hasOwnProperty('channel')) {
    console.log('publishMessageToChannel: An invalid message object was provided.');
    return 0;
  }
  if (!this.channels.hasOwnProperty(message.channel)) {
    console.log('publishMessageToChannel: The channel "' + message.channel + '" doesn\'t exist.');
    return 0;
  }

  var clientCount = 0;
  for (var sessionId in this.channels[message.channel].sessionIds) {
    if (this.publishMessageToClient(sessionId, message)) {
      clientCount++;
    }
  }
  if (this.settings.debug) {
    console.log('Sent message to ' + clientCount + ' clients in channel "' + message.channel + '"');
  }
  return clientCount;
};

/**
 * Broadcasts a message to all sockets.
 */
ClientManager.prototype.broadcastMessage = function (message) {
  if (this.settings.debug) {
    console.log('Broadcasting message:');
    console.log(message);
  }

  for (var socketId in this.sockets) {
    this.publishMessageToClient(socketId, message);
  }
};

/**
 * Returns the number of open sockets.
 */
ClientManager.prototype.getSocketCount = function () {
  return Object.keys(this.sockets).length;
};

module.exports = ClientManager;
