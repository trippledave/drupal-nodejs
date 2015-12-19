/**
 * Provides Node.js - Drupal integration.
 */

var request = require('request'),
    url = require('url'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    express = require('express'),
    util = require('util'),
    querystring = require('querystring'),
    vm = require('vm');

var channels = {},
    authenticatedClients = {},
    sockets = {},
    onlineUsers = {},
    presenceTimeoutIds = {},
    contentChannelTimeoutIds = {},
    tokenChannels = {},
    extensions = [];







/**
 * Check if the given channel is client-writable.
 */
var channelIsClientWritable = function (channel) {
  if (channels.hasOwnProperty(channel)) {
    return channels[channel].isClientWritable;
  }
  return false;
}

/**
 * Check if the given socket is in the given channel.
 */
var clientIsInChannel = function (socket, channel) {
  if (!channels.hasOwnProperty(channel)) {
    return false;
  }
  return channels[channel].sessionIds[socket.id];
}








/**
 * Authenticate a client connection based on the message it sent.
 */
var authenticateClient = function (client, message) {
  // If the authToken is verified, initiate a connection with the client.
  if (authenticatedClients[message.authToken]) {
    if (settings.debug) {
      console.log('Reusing existing authentication data for key:', message.authToken, ', client id:', client.id);
    }
    setupClientConnection(client.id, authenticatedClients[message.authToken], message.contentTokens);
  }
  else {
    message.messageType = 'authenticate';
    message.clientId = client.id;
    sendMessageToBackend(message, authenticateClientCallback);
  }
}

/**
 * Handle authentication call response.
 */
var authenticateClientCallback = function (error, response, body) {
  if (error) {
    console.log("Error with authenticate client request:", error);
    return;
  }
  if (response.statusCode == 404) {
    if (settings.debug) {
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
    if (settings.debug) {
      console.log('Failed message string: ' + body);
    }
    return;
  }
  if (!checkServiceKey(authData.serviceKey)) {
    console.log('Invalid service key "', authData.serviceKey, '"');
    return;
  }
  if (authData.nodejsValidAuthToken) {
    if (settings.debug) {
      console.log('Valid login for uid "', authData.uid, '"');
    }
    setupClientConnection(authData.clientId, authData, authData.contentTokens);
    authenticatedClients[authData.authToken] = authData;
  }
  else {
    console.log('Invalid login for uid "', authData.uid, '"');
    delete authenticatedClients[authData.authToken];
  }
}

/**
 * Send a presence notifcation for uid.
 */
var sendPresenceChangeNotification = function (uid, presenceEvent) {
  if (onlineUsers[uid]) {
    for (var i in onlineUsers[uid]) {
      var sessionIds = getNodejsSessionIdsFromUid(onlineUsers[uid][i]);
      if (sessionIds.length > 0 && settings.debug) {
        console.log('Sending presence notification for', uid, 'to', onlineUsers[uid][i]);
      }
      for (var j in sessionIds) {
        sockets[sessionIds[j]].json.send({'presenceNotification': {'uid': uid, 'event': presenceEvent}});
      }
    }
  }
  if (settings.debug) {
    console.log('sendPresenceChangeNotification', uid, presenceEvent, onlineUsers);
  }
}

/**
 * Callback that wraps all requests and checks for a valid service key.
 */
var checkServiceKeyCallback = function (request, response, next) {
  if (checkServiceKey(request.header('NodejsServiceKey', ''))) {
    next();
  }
  else {
    response.send({'error': 'Invalid service key.'});
  }
}


/**
 * Http callback - return the list of content channel users.
 */
var getContentTokenUsers = function (request, response) {
  var requestBody = '';
  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    requestBody += chunk;
  });
  request.on('end', function () {
    try {
      var channel = JSON.parse(requestBody);
    }
    catch (exception) {
      console.log('getContentTokensUsers: Invalid JSON "' + requestBody + '"', exception);
      response.send({error: 'Invalid JSON, error: ' + exception.toString()});
      return;
    }

    try {
      response.send({users: getContentTokenChannelUsers(channel.channel)});
    }
    catch (exception) {
      console.log('getContentTokensUsers:', exception);
      response.send({error: 'Error calling getContentTokenChannelUsers() for channel "' + channel.channel + '", error: ' + exception.toString()});
    }
  });
}

/**
 * Http callback - set the debug flag.
 */
var toggleDebug = function (request, response) {
  var requestBody = '';
  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    requestBody += chunk;
  });
  request.on('end', function () {
    try {
      var toggle = JSON.parse(requestBody);
      settings.debug = toggle.debug;
      response.send({debug: toggle.debug});
    }
    catch (exception) {
      console.log('toggleDebug: Invalid JSON "' + requestBody + '"', exception);
      response.send({error: 'Invalid JSON, error: ' + e.toString()});
    }
  });
}

/**
 * Http callback - read in a JSON message and publish it to interested clients.
 */
var healthCheck = function (request, response) {
  response.send({
    'authenticatedClients': Object.keys(authenticatedClients).length,
    'sockets': Object.keys(sockets).length,
    'onlineUsers': Object.keys(onlineUsers).length,
    'tokenChannels': Object.keys(tokenChannels).length,
    'status': 'success'
  });
}

/**
 * Http callback - read in a JSON message and publish it to interested clients.
 */
var publishMessage = function (request, response) {
  var sentCount = 0, requestBody = '';
  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    requestBody += chunk;
  });
  request.on('end', function () {
    try {
      var message = JSON.parse(requestBody);
      if (settings.debug) {
        console.log('publishMessage: message', message);
      }
    }
    catch (exception) {
      console.log('publishMessage: Invalid JSON "' + requestBody + '"',  exception);
      response.send({error: 'Invalid JSON, error: ' + exception.toString()});
      return;
    }
    if (message.broadcast) {
      if (settings.debug) {
        console.log('Broadcasting message');
      }
      io.sockets.json.send(message);
      sentCount = io.sockets.sockets.length;
    }
    else {
      sentCount = publishMessageToChannel(message);
    }
    process.emit('message-published', message, sentCount);
    response.send({sent: sentCount});
  });
}

/**
 * Publish a message to clients subscribed to a channel.
 */
var publishMessageToChannel = function (message) {
  if (!message.hasOwnProperty('channel')) {
    console.log('publishMessageToChannel: An invalid message object was provided.');
    return 0;
  }
  if (!channels.hasOwnProperty(message.channel)) {
    console.log('publishMessageToChannel: The channel "' + message.channel + '" doesn\'t exist.');
    return 0;
  }

  var clientCount = 0;
  for (var sessionId in channels[message.channel].sessionIds) {
    if (publishMessageToClient(sessionId, message)) {
      clientCount++;
    }
  }
  if (settings.debug) {
    console.log('Sent message to ' + clientCount + ' clients in channel "' + message.channel + '"');
  }
  return clientCount;
}

/**
 * Publish a message to clients subscribed to a channel.
 */
var publishMessageToContentChannel = function (request, response) {
  var sentCount = 0, requestBody = '';
  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    requestBody += chunk;
  });
  request.on('end', function () {
    try {
      var message = JSON.parse(requestBody);
      if (settings.debug) {
        console.log('publishMessageToContentChannel: message', message);
      }
    }
    catch (exception) {
      console.log('publishMessageToContentChannel: Invalid JSON "' + requestBody + '"', exception);
      response.send({error: 'Invalid JSON, error: ' + exception.toString()});
      return;
    }
    if (!message.hasOwnProperty('channel')) {
      console.log('publishMessageToContentChannel: An invalid message object was provided.');
      response.send({error: 'Invalid message'});
      return;
    }
    if (!tokenChannels.hasOwnProperty(message.channel)) {
      console.log('publishMessageToContentChannel: The channel "' + message.channel + '" doesn\'t exist.');
      response.send({error: 'Invalid message'});
      return;
    }

    for (var socketId in tokenChannels[message.channel].sockets) {
      publishMessageToClient(socketId, message);
    }
    response.send({sent: 'sent'});
  });
}

/**
 * Publish a message to a specific client.
 */
var publishMessageToClient = function (sessionId, message) {
  if (sockets[sessionId]) {
    sockets[sessionId].json.send(message);
    if (settings.debug) {
      console.log('Sent message to client ' + sessionId);
    }
    return true;
  }
  else {
    console.log('publishMessageToClient: Failed to find client ' + sessionId);
  }
};

/**
 * Sends a 404 message.
 */
var send404 = function (request, response) {
  response.send('Not Found.', 404);
};

/**
 * Kicks the given logged in user from the server.
 */
var kickUser = function (request, response) {
  if (request.params.uid) {
    // Delete the user from the authenticatedClients hash.
    for (var authToken in authenticatedClients) {
      if (authenticatedClients[authToken].uid == request.params.uid) {
        delete authenticatedClients[authToken];
      }
    }
    // Destroy any socket connections associated with this uid.
    for (var clientId in sockets) {
      if (sockets[clientId].uid == request.params.uid) {
        delete sockets[clientId];
        if (settings.debug) {
          console.log('kickUser: deleted socket "' + clientId + '" for uid "' + request.params.uid + '"');
        }
        // Delete any channel entries for this clientId.
        for (var channel in channels) {
          delete channels[channel].sessionIds[clientId];
        }
      }
    }
    response.send({'status': 'success'});
    return;
  }
  console.log('Failed to kick user, no uid supplied');
  response.send({'status': 'failed', 'error': 'missing uid'});
};

/**
 * Logout the given user from the server.
 */
var logoutUser = function (request, response) {
  var authToken = request.params.authtoken || '';
  if (authToken) {
    console.log('Logging out http session', authToken);
    // Delete the user from the authenticatedClients hash.
    delete authenticatedClients[authToken];

    // Destroy any socket connections associated with this authToken.
    for (var clientId in sockets) {
      if (sockets[clientId].authToken == authToken) {
        cleanupSocket(sockets[clientId]);
      }
    }
    response.send({'status': 'success'});
    return;
  }
  console.log('Failed to logout user, no authToken supplied');
  response.send({'status': 'failed', 'error': 'missing authToken'});
};

/**
 * Get the list of backend uids and authTokens connected to a content token channel.
 */
var getContentTokenChannelUsers = function (channel) {
  var users = {uids: [], authTokens: []};
  for (var sessionId in tokenChannels[channel].sockets) {
    if (sockets[sessionId].uid) {
      users.uids.push(sockets[sessionId].uid);
    }
    else {
      users.authTokens.push(sockets[sessionId].authToken);
    }
  }
  return users;
}

/**
 * Get the list of Node.js sessionIds for a given uid.
 */
var getNodejsSessionIdsFromUid = function (uid) {
  var sessionIds = [];
  for (var sessionId in sockets) {
    if (sockets[sessionId].uid == uid) {
      sessionIds.push(sessionId);
    }
  }
  if (settings.debug) {
    console.log('getNodejsSessionIdsFromUid', {uid: uid, sessionIds: sessionIds});
  }
  return sessionIds;
}

/**
 * Get the list of Node.js sessionIds for a given authToken.
 */
var getNodejsSessionIdsFromAuthToken = function (authToken) {
  var sessionIds = [];
  for (var sessionId in sockets) {
    if (sockets[sessionId].authToken == authToken) {
      sessionIds.push(sessionId);
    }
  }
  if (settings.debug) {
    console.log('getNodejsSessionIdsFromAuthToken', {authToken: authToken, sessionIds: sessionIds});
  }
  return sessionIds;
}

/**
 * Add a user to a channel.
 */
var addUserToChannel = function (request, response) {
  var uid = request.params.uid || '';
  var channel = request.params.channel || '';
  if (uid && channel) {
    if (!/^\d+$/.test(uid)) {
      console.log("Invalid uid: " + uid);
      response.send({'status': 'failed', 'error': 'Invalid uid.'});
      return;
    }
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log("Invalid channel: " + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }
    channels[channel] = channels[channel] || {'sessionIds': {}};
    var sessionIds = getNodejsSessionIdsFromUid(uid);
    if (sessionIds.length > 0) {
      for (var i in sessionIds) {
        channels[channel].sessionIds[sessionIds[i]] = sessionIds[i];
      }
      if (settings.debug) {
        console.log("Added channel '" + channel + "' to sessionIds " + sessionIds.join());
      }
      response.send({'status': 'success'});
    }
    else {
      console.log("No active sessions for uid: " + uid);
      response.send({'status': 'failed', 'error': 'No active sessions for uid.'});
    }
    for (var authToken in authenticatedClients) {
      if (authenticatedClients[authToken].uid == uid) {
        if (authenticatedClients[authToken].channels.indexOf(channel) == -1) {
          authenticatedClients[authToken].channels.push(channel);
          if (settings.debug) {
            console.log("Added channel '" + channel + "' authenticatedClients");
          }
        }
      }
    }
  }
  else {
    console.log("Missing uid or channel");
    response.send({'status': 'failed', 'error': 'Missing uid or channel'});
  }
};

/**
 * Add an authToken to a channel.
 */
var addAuthTokenToChannel = function (request, response) {
  var authToken = request.params.authToken || '';
  var channel = request.params.channel || '';
  if (!authToken || !channel) {
    console.log("Missing authToken or channel");
    response.send({'status': 'failed', 'error': 'Missing authToken or channel'});
    return;
  }

  if (!/^[a-z0-9_]+$/i.test(channel)) {
    console.log("Invalid channel: " + channel);
    response.send({'status': 'failed', 'error': 'Invalid channel name.'});
    return;
  }
  if (!authenticatedClients[authToken]) {
    console.log("Unknown authToken : " + authToken);
    response.send({'status': 'failed', 'error': 'Invalid authToken.'});
    return;
  }
  channels[channel] = channels[channel] || {'sessionIds': {}};
  var sessionIds = getNodejsSessionIdsFromAuthtoken(authToken);
  if (sessionIds.length > 0) {
    for (var i in sessionIds) {
      channels[channel].sessionIds[sessionIds[i]] = sessionIds[i];
    }
    if (settings.debug) {
      console.log("Added sessionIds '" + sessionIds.join() + "' to channel '" + channel + "'");
    }
    response.send({'status': 'success'});
  }
  else {
    console.log("No active sessions for authToken: " + authToken);
    response.send({'status': 'failed', 'error': 'No active sessions for uid.'});
  }
  if (authenticatedClients[authToken].channels.indexOf(channel) == -1) {
    authenticatedClients[authToken].channels.push(channel);
    if (settings.debug) {
      console.log("Added channel '" + channel + "' to authenticatedClients");
    }
  }
};

/**
 * Add a client (specified by session ID) to a channel.
 */
var addClientToChannel = function (sessionId, channel) {
  if (sessionId && channel) {
    if (!/^[0-9a-z_-]+$/i.test(sessionId) || !sockets.hasOwnProperty(sessionId)) {
      console.log("addClientToChannel: Invalid sessionId: " + sessionId);
    }
    else if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log("addClientToChannel: Invalid channel: " + channel);
    }
    else {
      channels[channel] = channels[channel] || {'sessionIds': {}};
      channels[channel].sessionIds[sessionId] = sessionId;
      if (settings.debug) {
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
 * Remove a channel.
 */
var removeChannel = function (request, response) {
  var channel = request.params.channel || '';
  if (channel) {
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }
    if (channels[channel]) {
      delete channels[channel];
      if (settings.debug) {
        console.log("Successfully removed channel '" + channel + "'");
      }
      response.send({'status': 'success'});
    }
    else {
      console.log("Non-existent channel name '" + channel + "'");
      response.send({'status': 'failed', 'error': 'Non-existent channel name.'});
      return;
    }
  }
  else {
    console.log("Missing channel");
    response.send({'status': 'failed', 'error': 'Invalid data: missing channel'});
  }
}

/**
 * Add a channel.
 */
var addChannel = function (request, response) {
  var channel = request.params.channel || '';
  if (channel) {
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }
    if (channels[channel]) {
      console.log("Channel name '" + channel + "' already exists.");
      response.send({'status': 'failed', 'error': "Channel name '" + channel + "' already exists."});
      return;
    }
    channels[channel] = {'sessionIds': {}};
    if (settings.debug) {
      console.log("Successfully added channel '" + channel + "'");
    }
    response.send({'status': 'success'});
  }
  else {
    console.log("Missing channel");
    response.send({'status': 'failed', 'error': 'Invalid data: missing channel'});
  }
}

/**
 * Checks whether a channel exists.
 */
var checkChannel = function (request, response) {
  var channel = request.params.channel || '';
  if (channel) {
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }
    if (channels[channel]) {
      console.log("Channel name '" + channel + "' is active on the server.");
      response.send({'status': 'success', 'result': true});
      return;
    }
    else {
      console.log("Channel name '" + channel + "' is not active on the server.");
      response.send({'status': 'success', 'result': false});
    }
  }
  else {
    console.log("Missing channel");
    response.send({'status': 'failed', 'error': 'Invalid data: missing channel'});
  }
}

/**
 * Remove a user from a channel.
 */
var removeUserFromChannel = function (request, response) {
  var uid = request.params.uid || '';
  var channel = request.params.channel || '';
  if (uid && channel) {
    if (!/^\d+$/.test(uid)) {
      console.log('Invalid uid: ' + uid);
      response.send({'status': 'failed', 'error': 'Invalid uid.'});
      return;
    }
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }
    if (channels[channel]) {
      var sessionIds = getNodejsSessionIdsFromUid(uid);
      for (var i in sessionIds) {
        if (channels[channel].sessionIds[sessionIds[i]]) {
          delete channels[channel].sessionIds[sessionIds[i]];
        }
      }
      for (var authToken in authenticatedClients) {
        if (authenticatedClients[authToken].uid == uid) {
          var index = authenticatedClients[authToken].channels.indexOf(channel);
          if (index != -1) {
            delete authenticatedClients[authToken].channels[index];
          }
        }
      }
      if (settings.debug) {
        console.log("Successfully removed uid '" + uid + "' from channel '" + channel + "'");
      }
      response.send({'status': 'success'});
    }
    else {
      console.log("Non-existent channel name '" + channel + "'");
      response.send({'status': 'failed', 'error': 'Non-existent channel name.'});
      return;
    }
  }
  else {
    console.log("Missing uid or channel");
    response.send({'status': 'failed', 'error': 'Invalid data'});
  }
}

/**
 * Remove an authToken from a channel.
 */
var removeAuthTokenFromChannel = function (request, response) {
  var authToken = request.params.authToken || '';
  var channel = request.params.channel || '';
  if (authToken && channel) {
    if (!authenticatedClients[authToken]) {
      console.log('Invalid authToken: ' + uid);
      response.send({'status': 'failed', 'error': 'Invalid authToken.'});
      return;
    }
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }
    if (channels[channel]) {
      var sessionIds = getNodejsSessionIdsFromAuthToken(authToken);
      for (var i in sessionIds) {
        if (channels[channel].sessionIds[sessionIds[i]]) {
          delete channels[channel].sessionIds[sessionIds[i]];
        }
      }
      if (authenticatedClients[authToken]) {
        var index = authenticatedClients[authToken].channels.indexOf(channel);
        if (index != -1) {
          delete authenticatedClients[authToken].channels[index];
        }
      }
      if (settings.debug) {
        console.log("Successfully removed authToken '" + authToken + "' from channel '" + channel + "'.");
      }
      response.send({'status': 'success'});
    }
    else {
      console.log("Non-existent channel name '" + channel + "'");
      response.send({'status': 'failed', 'error': 'Non-existent channel name.'});
      return;
    }
  }
  else {
    console.log("Missing authToken or channel");
    response.send({'status': 'failed', 'error': 'Invalid data'});
  }
}

/**
 * Remove a client (specified by session ID) from a channel.
 */
var removeClientFromChannel = function (sessionId, channel) {
  if (sessionId && channel) {
    if (!/^[0-9a-z_-]+$/i.test(sessionId) || !sockets.hasOwnProperty(sessionId)) {
      console.log("removeClientFromChannel: Invalid sessionId: " + sessionId);
    }
    else if (!/^[a-z0-9_]+$/i.test(channel) || !channels.hasOwnProperty(channel)) {
      console.log("removeClientFromChannel: Invalid channel: " + channel);
    }
    else if (channels[channel].sessionIds[sessionId]) {
      delete channels[channels].sessionIds[sessionId];
      if (settings.debug) {
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
 * Set the list of users a uid can see presence info about.
 */
var setUserPresenceList = function (uid, uids) {
  var uid = request.params.uid || '';
  var uidlist = request.params.uidlist.split(',') || [];
  if (uid && uidlist) {
    if (!/^\d+$/.test(uid)) {
      console.log("Invalid uid: " + uid);
      response.send({'status': 'failed', 'error': 'Invalid uid.'});
      return;
    }
    if (uidlist.length == 0) {
      console.log("Empty uidlist");
      response.send({'status': 'failed', 'error': 'Empty uid list.'});
      return;
    }
    for (var i in uidlist) {
      if (!/^\d+$/.test(uidlist[i])) {
        console.log("Invalid uid: " + uid);
        response.send({'status': 'failed', 'error': 'Invalid uid.'});
        return;
      }
    }
    onlineUsers[uid] = uidlist;
    response.send({'status': 'success'});
  }
  else {
    response.send({'status': 'failed', 'error': 'Invalid parameters.'});
  }
}

/**
 * Cleanup after a socket has disconnected.
 */
var cleanupSocket = function (socket) {
  if (settings.debug) {
    console.log("Cleaning up after socket id", socket.id, 'uid', socket.uid);
  }
  for (var channel in channels) {
    delete channels[channel].sessionIds[socket.id];
  }
  var uid = socket.uid;
  if (uid != 0) {
    if (presenceTimeoutIds[uid]) {
      clearTimeout(presenceTimeoutIds[uid]);
    }
    presenceTimeoutIds[uid] = setTimeout(checkOnlineStatus, 2000, uid);
  }

  for (var tokenChannel in tokenChannels) {
    console.log("cleanupSocket: checking tokenChannel", tokenChannel, socket.id);
    if (tokenChannels[tokenChannel].sockets[socket.id]) {
      console.log("cleanupSocket: found socket.id for tokenChannel", tokenChannel, tokenChannels[tokenChannel].sockets[socket.id]);
      if (tokenChannels[tokenChannel].sockets[socket.id].notifyOnDisconnect) {
        if (contentChannelTimeoutIds[tokenChannel + '_' + uid]) {
          clearTimeout(contentChannelTimeoutIds[tokenChannel + '_' + uid]);
        }
        contentChannelTimeoutIds[tokenChannel + '_' + uid] = setTimeout(checkTokenChannelStatus, 2000, tokenChannel, socket);
      }
      delete tokenChannels[tokenChannel].sockets[socket.id];
    }
  }

  delete sockets[socket.id];
}

/**
 * Check for any open sockets associated with the channel and socket pair.
 */
var checkTokenChannelStatus = function (tokenChannel, socket) {
  // If the tokenChannel no longer exists, just bail.
  if (!tokenChannels[tokenChannel]) {
    console.log("checkTokenChannelStatus: no tokenChannel", tokenChannel, socket.uid);
    return;
  }

  // If we find a socket for this user in the given tokenChannel, we can just
  // return, as there's nothing we need to do.
  var sessionIds = getNodejsSessionIdsFromUid(socket.uid);
  for (var i = 0; i < sessionIds.length; i++) {
    if (tokenChannels[tokenChannel].sockets[sessionIds[i]]) {
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
  for (var socketId in tokenChannels[tokenChannel].sockets) {
    publishMessageToClient(socketId, message);
  }
}

/**
 * Check for any open sockets for uid.
 */
var checkOnlineStatus = function (uid) {
  if (getNodejsSessionIdsFromUid(uid).length == 0) {
    if (settings.debug) {
      console.log("Sending offline notification for", uid);
    }
    setUserOffline(uid);
  }
}

/**
 * Sends offline notification to sockets, the backend and cleans up our list.
 */
var setUserOffline = function (uid) {
  sendPresenceChangeNotification(uid, 'offline');
  delete onlineUsers[uid];
  sendMessageToBackend({uid: uid, messageType: 'userOffline'}, function (response) { });
}

/**
 * Set a content token.
 */
var setContentToken = function (request, response) {
  var requestBody = '';
  request.setEncoding('utf8');
  request.on('data', function (chunk) {
    requestBody += chunk;
  });
  request.on('end', function () {
    try {
      var message = JSON.parse(requestBody);
      if (settings.debug) {
        console.log('setContentToken: message', message);
      }
    }
    catch (exception) {
      console.log('setContentToken: Invalid JSON "' + requestBody + '"',  exception);
      response.send({error: 'Invalid JSON, error: ' + exception.toString()});
      return;
    }
    tokenChannels[message.channel] = tokenChannels[message.channel] || {'tokens': {}, 'sockets': {}};
    tokenChannels[message.channel].tokens[message.token] = message;
    if (settings.debug) {
      console.log('setContentToken', message.token, 'for channel', message.channel);
    }
    response.send({status: 'ok'});
  });
}

/**
 * Setup a sockets{}.connection with uid, channels etc.
 */
var setupClientConnection = function (sessionId, authData, contentTokens) {
  if (!sockets[sessionId]) {
    console.log("Client socket '" + sessionId + "' went away.");
    return;
  }
  sockets[sessionId].authToken = authData.authToken;
  sockets[sessionId].uid = authData.uid;
  for (var i in authData.channels) {
    channels[authData.channels[i]] = channels[authData.channels[i]] || {'sessionIds': {}};
    channels[authData.channels[i]].sessionIds[sessionId] = sessionId;
  }
  if (authData.uid != 0) {
    var sendPresenceChange = !onlineUsers[authData.uid];
    onlineUsers[authData.uid] = authData.presenceUids || [];
    if (sendPresenceChange) {
      sendPresenceChangeNotification(authData.uid, 'online');
    }
  }

  var clientToken = '';
  for (var tokenChannel in contentTokens) {
    tokenChannels[tokenChannel] = tokenChannels[tokenChannel] || {'tokens': {}, 'sockets': {}};

    clientToken = contentTokens[tokenChannel];
    if (tokenChannels[tokenChannel].tokens[clientToken]) {
      tokenChannels[tokenChannel].sockets[sessionId] = tokenChannels[tokenChannel].tokens[clientToken];
      if (settings.debug) {
        console.log('Added token', clientToken, 'for channel', tokenChannel, 'for socket', sessionId);
      }
      delete tokenChannels[tokenChannel].tokens[clientToken];
    }
  }

  process.emit('client-authenticated', sessionId, authData);

  if (settings.debug) {
    console.log("Added channels for uid " + authData.uid + ': ' + authData.channels.toString());
    console.log('setupClientConnection', onlineUsers);
  }
};


