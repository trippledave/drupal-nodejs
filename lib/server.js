/*
* Submodule for setting up the server.
*/
'use strict';

var express = require('express');
var fs = require('fs');
var http = require('http');
var https = require('https');
var bodyParser = require('body-parser');
var routes = require('./routes');
var backend = require('./backend');
var configManager = require('./config-manager');
var clientManager = require('./client-manager');

var settings = configManager.getSettings();
var server = {};


/**
 * Starts the server.
 */
server.start = function () {
  var app = express();

  // The client manager keeps track of connected sockets, so we need to ensure the routes module has the same instance.
  routes.useClientManager(clientManager);

  app.use(bodyParser.json({}));

  app.all(settings.baseAuthPath + '*', routes.checkServiceKey);
  app.post(settings.baseAuthPath + 'publish', routes.publishMessage);
  app.post(settings.baseAuthPath + 'user/kick/:uid', routes.kickUser);
  app.post(settings.baseAuthPath + 'user/logout/:authtoken', routes.logoutUser);
  app.post(settings.baseAuthPath + 'user/channel/add/:channel/:uid', routes.addUserToChannel);
  app.post(settings.baseAuthPath + 'user/channel/remove/:channel/:uid', routes.removeUserFromChannel);
  app.post(settings.baseAuthPath + 'channel/add/:channel', routes.addChannel);
  app.get(settings.baseAuthPath + 'health/check', routes.healthCheck);
  app.get(settings.baseAuthPath + 'channel/check/:channel', routes.checkChannel);
  app.post(settings.baseAuthPath + 'channel/remove/:channel', routes.removeChannel);
  app.get(settings.baseAuthPath + 'user/presence-list/:uid/:uidList', routes.setUserPresenceList);
  app.post(settings.baseAuthPath + 'debug/toggle', routes.toggleDebug);
  app.post(settings.baseAuthPath + 'content/token/users', routes.getContentTokenUsers);
  app.post(settings.baseAuthPath + 'content/token', routes.setContentToken);
  app.post(settings.baseAuthPath + 'content/token/message', routes.publishMessageToContentChannel);
  app.post(settings.baseAuthPath + 'authtoken/channel/add/:channel/:authToken', routes.addAuthTokenToChannel);
  app.post(settings.baseAuthPath + 'authtoken/channel/remove/:channel/:authToken', routes.removeAuthTokenFromChannel);
  app.get('*', routes.send404);

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

  // The extensions will have access to all connection data via the clientManager object. They can also do
  // require('./config-manager') to gain access to the settings array.
  configManager.invokeExtensions('setup', clientManager);
};

module.exports = server;
