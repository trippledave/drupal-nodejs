/**
 * Submodule for handling communication with the backend.
 */
'use strict';

var querystring = require('querystring');
var configManager = require('./config-manager');
var settings = configManager.getSettings();

var backend = {};

/**
 * Check a service key against the configured service key.
 */
backend.checkServiceKey = function (serviceKey) {
  if (settings.serviceKey && serviceKey != settings.serviceKey) {
    console.log('Invalid service key "' + serviceKey + '", expecting "' + settings.serviceKey + '"');
    return false;
  }
  return true;
};

/**
 * Returns the backend url.
 */
backend.getBackendUrl = function () {
  return settings.backend.scheme + '://' + settings.backend.host + ':' +
    settings.backend.port + settings.backend.basePath + settings.backend.messagePath;
};

/**
 * Returns the header for backend requests.
 */
backend.getAuthHeader = function() {
  if (settings.backend.httpAuth.length > 0) {
    return 'Basic ' + new Buffer(settings.backend.httpAuth).toString('base64');
  }
  return false;
};

/**
 * Send a message to the backend.
 */
backend.sendMessageToBackend = function (message, callback) {
  var requestBody = querystring.stringify({
    messageJson: JSON.stringify(message),
    serviceKey: settings.serviceKey
  });

  var options = {
    uri: this.getBackendUrl(),
    body: requestBody,
    headers: {
      'Content-Length': Buffer.byteLength(requestBody),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }

  if (settings.backend.scheme == 'https') {
    options.strictSSL = settings.backend.strictSSL;
  }

  var httpAuthHeader = this.getAuthHeader();
  if (httpAuthHeader !== false) {
    options.headers.Authorization = httpAuthHeader;
  }

  if (settings.debug) {
    console.log("Sending message to backend", message, options);
  }
  request.post(options, callback);
};

module.exports = backend;
