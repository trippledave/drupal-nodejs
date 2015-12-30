/**
 * Submodule for handling communication with the backend.
 */
'use strict';

var request = require('request');
var querystring = require('querystring');

/**
 * Constructor.
 */
function Backend(settings) {
  this.settings = settings;
}

/**
 * Check a service key against the configured service key.
 */
Backend.prototype.checkServiceKey = function (serviceKey) {
  if (this.settings.serviceKey && serviceKey != this.settings.serviceKey) {
    console.log('Invalid service key "' + serviceKey + '", expecting "' + this.settings.serviceKey + '"');
    return false;
  }
  return true;
};

/**
 * Returns the backend url.
 */
Backend.prototype.getBackendUrl = function () {
  return this.settings.backend.scheme + '://' + this.settings.backend.host + ':' +
    this.settings.backend.port + this.settings.backend.basePath + this.settings.backend.messagePath;
};

/**
 * Returns the header for backend requests.
 */
Backend.prototype.getAuthHeader = function() {
  if (this.settings.backend.httpAuth.length > 0) {
    return 'Basic ' + new Buffer(this.settings.backend.httpAuth).toString('base64');
  }
  return false;
};

/**
 * Send a message to the backend.
 */
Backend.prototype.sendMessageToBackend = function (message, callback) {
  var requestBody = querystring.stringify({
    messageJson: JSON.stringify(message),
    serviceKey: this.settings.serviceKey
  });

  var options = {
    uri: this.getBackendUrl(),
    body: requestBody,
    headers: {
      'Content-Length': Buffer.byteLength(requestBody),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  if (this.settings.backend.scheme == 'https') {
    options.strictSSL = this.settings.backend.strictSSL;
  }

  var httpAuthHeader = this.getAuthHeader();
  if (httpAuthHeader !== false) {
    options.headers.Authorization = httpAuthHeader;
  }

  if (this.settings.debug) {
    console.log("Sending message to backend", message, options);
  }
  request.post(options, callback);
};

module.exports = Backend;
