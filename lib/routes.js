/**
 * Submodule for router callbacks.
 */
'use strict';

var backend = require('./backend');
var configManager = require('./config-manager');

var settings = configManager.getSettings();
var routes = {
  clientManager: null
};

/**
 * Sets the client manager to be used by routes.
 *
 * @param clientManager
 *   An instance of the client-manager module.
 */
routes.useClientManager = function (clientManager) {
  routes.clientManager = clientManager;
};

/**
 * Callback that wraps all requests and checks for a valid service key.
 */
routes.checkServiceKey = function (request, response, next) {
  if (backend.checkServiceKey(request.header('NodejsServiceKey', ''))) {
    next();
  }
  else {
    response.send({'error': 'Invalid service key.'});
  }
};

/**
 * Http callback - read in a JSON message and publish it to interested clients.
 */
routes.publishMessage = function (request, response) {
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
      routes.clientManager.broadcastMessage(message);
      sentCount = routes.clientManager.getSocketCount();
    }
    else {
      sentCount = routes.clientManager.publishMessageToChannel(message);
    }
    process.emit('message-published', message, sentCount);
    response.send({sent: sentCount});
  });
};


/**
 * Kicks the given logged in user from the server.
 */
routes.kickUser = function (request, response) {
  if (request.params.uid) {
    routes.clientManager.kickUser(request.params.uid);
    response.send({'status': 'success'});
    return;
  }
  console.log('Failed to kick user, no uid supplied');
  response.send({'status': 'failed', 'error': 'missing uid'});
};

/**
 * Logout the given user from the server.
 */
routes.logoutUser = function (request, response) {
  var authToken = request.params.authtoken || '';
  if (authToken) {
    console.log('Logging out http session', authToken);
    routes.clientManager.kickUser(authToken);
    response.send({'status': 'success'});
    return;
  }
  console.log('Failed to logout user, no authToken supplied');
  response.send({'status': 'failed', 'error': 'missing authToken'});
};

/**
 * Add a user to a channel.
 */
routes.addUserToChannel = function (request, response) {
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

    var result = routes.clientManager.addUserToChannel(channel, uid);
    if (result) {
      response.send({'status': 'success'});
    }
    else {
      response.send({'status': 'failed', 'error': 'No active sessions for uid.'});
    }
  }
  else {
    console.log("Missing uid or channel");
    response.send({'status': 'failed', 'error': 'Missing uid or channel'});
  }
};

/**
 * Remove a user from a channel.
 */
routes.removeUserFromChannel = function (request, response) {
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

    var result = routes.clientManager.removeUserFromChannel(channel, uid);
    if (result) {
      response.send({'status': 'success'});
    }
    else {
      response.send({'status': 'failed', 'error': 'Non-existent channel name.'});
    }
  }
  else {
    console.log("Missing uid or channel");
    response.send({'status': 'failed', 'error': 'Invalid data'});
  }
};

/**
 * Add a channel.
 */
routes.addChannel = function (request, response) {
  var channel = request.params.channel || '';
  if (channel) {
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }

    var result = routes.clientManager.addChannel(channel);
    if (result) {
      response.send({'status': 'success'});
    }
    else {
      response.send({'status': 'failed', 'error': "Channel name '" + channel + "' already exists."});
    }
  }
  else {
    console.log("Missing channel");
    response.send({'status': 'failed', 'error': 'Invalid data: missing channel'});
  }
};

/**
 * Http callback - read in a JSON message and publish it to interested clients.
 */
routes.healthCheck = function (request, response) {
  var data = routes.clientManager.getData();
  data.status = 'success';
  response.send(data);
};

/**
 * Checks whether a channel exists.
 */
routes.checkChannel = function (request, response) {
  var channel = request.params.channel || '';
  if (channel) {
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }

    var result = routes.clientManager.checkChannel(channel);

    if (result) {
      response.send({'status': 'success', 'result': true});
    }
    else {
      response.send({'status': 'success', 'result': false});
    }
  }
  else {
    console.log("Missing channel");
    response.send({'status': 'failed', 'error': 'Invalid data: missing channel'});
  }
};

/**
 * Remove a channel.
 */
routes.removeChannel = function (request, response) {
  var channel = request.params.channel || '';
  if (channel) {
    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }

    var result = routes.clientManager.removeChannel(channel);
    if (result) {
      response.send({'status': 'success'});
    }
    else {
      response.send({'status': 'failed', 'error': 'Non-existent channel name.'});
    }
  }
  else {
    console.log("Missing channel");
    response.send({'status': 'failed', 'error': 'Invalid data: missing channel'});
  }
};

/**
 * Set the list of users a uid can see presence info about.
 */
routes.setUserPresenceList = function (uid, uids) {
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

    var result = routes.clientManager.setUserPresenceList(uid, uidlist);
    if (result) {
      response.send({'status': 'success'});
    }
    else {
      response.send({'status': 'failed', 'error': 'Invalid uid.'});
    }
  }
  else {
    response.send({'status': 'failed', 'error': 'Invalid parameters.'});
  }
};

/**
 * Http callback - return the list of content channel users.
 */
routes.getContentTokenUsers = function (request, response) {
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
      response.send({users: routes.clientManager.getContentTokenChannelUsers(channel.channel)});
    }
    catch (exception) {
      console.log('getContentTokensUsers:', exception);
      response.send({error: 'Error calling getContentTokenChannelUsers() for channel "' + channel.channel + '", error: ' + exception.toString()});
    }
  });
};

/**
 * Set a content token.
 */
routes.setContentToken = function (request, response) {
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

    routes.clientManager.setContentToken(message.channel, message.token, message);

    if (settings.debug) {
      console.log('setContentToken', message.token, 'for channel', message.channel);
    }
    response.send({status: 'ok'});
  });
};

/**
 * Publish a message to clients subscribed to a channel.
 */
routes.publishMessageToContentChannel = function (request, response) {
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

    var result = routes.clientManager.publishMessageToContentChannel(message.channel, message);
    if (result) {
      response.send({sent: 'sent'});
    }
    else {
      response.send({error: 'Invalid message'});
    }

  });
};

/**
 * Add an authToken to a channel.
 * @TODO Unused, needs testing.
 */
routes.addAuthTokenToChannel = function (request, response) {
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

  var result = routes.clientManager.addAuthTokenToChannel(channel, authToken);
  if (result) {
    response.send({'status': 'success'});
  }
  else {
    response.send({'status': 'failed', 'error': 'Invalid parameters.'});
  }
};

/**
 * Remove an authToken from a channel.
 * @TODO Unused, needs testing.
 */
routes.removeAuthTokenFromChannel = function (request, response) {
  var authToken = request.params.authToken || '';
  var channel = request.params.channel || '';
  if (authToken && channel) {


    if (!/^[a-z0-9_]+$/i.test(channel)) {
      console.log('Invalid channel: ' + channel);
      response.send({'status': 'failed', 'error': 'Invalid channel name.'});
      return;
    }

    var result = routes.clientManager.removeAuthTokenFromChannel(channel, authToken);
    if (result) {
      response.send({'status': 'success'});
    }
    else {
      response.send({'status': 'failed', 'error': 'Invalid parameters.'});
    }
  }
  else {
    console.log("Missing authToken or channel");
    response.send({'status': 'failed', 'error': 'Invalid data'});
  }
};

/**
 * Http callback - set the debug flag.
 */
routes.toggleDebug = function (request, response) {
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
};

/**
 * Sends a 404 message.
 */
routes.send404 = function (request, response) {
  response.send('Not Found.', 404);
};

module.exports = routes;
