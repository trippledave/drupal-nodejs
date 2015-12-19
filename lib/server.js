/*
* Submodule for setting up the server.
*/
'use strict';

var express = require('express');
var fs = require('fs');
var http = require('http');
var https = require('https');
var routes = require('./routes');
var backend = require('./backend');
var configManager = require('./config-manager');
var clientManager = require('./client-manager');

var settings = configManager.getSettings();
routes.useClientManager(clientManager);

var server = {};

var app = express();
app.all(settings.baseAuthPath + '*', checkServiceKey);
app.post(settings.baseAuthPath + 'publish', publishMessage);
app.get(settings.baseAuthPath + 'user/kick/:uid', kickUser);
app.get(settings.baseAuthPath + 'user/logout/:authtoken', logoutUser);
app.get(settings.baseAuthPath + 'user/channel/add/:channel/:uid', addUserToChannel);
app.get(settings.baseAuthPath + 'user/channel/remove/:channel/:uid', removeUserFromChannel);
app.get(settings.baseAuthPath + 'channel/add/:channel', addChannel);
app.get(settings.baseAuthPath + 'health/check', healthCheck);
app.get(settings.baseAuthPath + 'channel/check/:channel', checkChannel);
app.get(settings.baseAuthPath + 'channel/remove/:channel', removeChannel);
app.get(settings.baseAuthPath + 'user/presence-list/:uid/:uidList', setUserPresenceList);
app.post(settings.baseAuthPath + 'debug/toggle', toggleDebug);
app.post(settings.baseAuthPath + 'content/token/users', getContentTokenUsers);
app.post(settings.baseAuthPath + 'content/token', setContentToken);
app.post(settings.baseAuthPath + 'content/token/message', publishMessageToContentChannel);
app.get('*', send404);

// @TODO: These two paths were defined in the config, but have not been implemented.
//  addAuthTokenToChannelUrl: 'authtoken/channel/add/:channel/:uid',
//  removeAuthTokenFromChannelUrl: 'authtoken/channel/remove/:channel/:uid',

var httpServer;
if (settings.scheme == 'https') {
  var sslOptions = {
    key: fs.readFileSync(settings.sslKeyPath),
    cert: fs.readFileSync(settings.sslCertPath)
  };
  if (settings.sslCAPath) {
    sslOptions.ca = fs.readFileSync(settings.sslCAPath);
  }
  if (settings.sslPassPhrase) {
    sslOptions.passphrase = settings.sslPassPhrase;
  }
  httpServer = https.createServer(sslOptions, app);
}
else {
  httpServer = http.createServer(app);
}

// Allow extensions to add routes.
var extensionRoutes = configManager.getExtensionRoutes();
extensionRoutes.forEach(function (route) {
    if (route.type == 'post') {
      httpServer.post(route.path, route.handler);
    }
    else {
      httpServer.get(route.path, route.handler);
    }
});

httpServer.listen(settings.port, settings.host);
console.log('Started ' + settings.scheme + ' server.');

var io_options = {};
io_options['transports'] = settings.transports;
io_options['log level'] = settings.logLevel;
io_options['port'] = settings.port;
if (settings.jsEtag) {
  io_options['browser client etag'] = true;
}
if (settings.jsMinification) {
  io_options['browser client minification'] = true;
}

var io = require('socket.io')(httpServer, io_options);
clientManager.initSocketIo(io);

/**
 * Define a configuration object to pass to all server extensions at
 * initialization. The extensions do not have access to this namespace,
 * so we provide them with references.
 */
var extensionsConfig = {
  'publishMessageToChannel': publishMessageToChannel,
  'publishMessageToClient': publishMessageToClient,
  'publishMessageToContentChannel': publishMessageToContentChannel,
  'addClientToChannel': addClientToChannel,
  'settings': settings,
  'channels': channels,
  'io': io,
  'tokenChannels': tokenChannels,
  'authenticatedClients': authenticatedClients,
  'request': request,
  'server': server,
  'sendMessageToBackend': sendMessageToBackend
};
invokeExtensions('setup', extensionsConfig);

module.exports = server;
