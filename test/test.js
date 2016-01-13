var assert = require('assert');
var url = require('url');
var request = require('request');
var configManager = require('../lib/config-manager');
var settings = configManager.getSettings();

describe('Server app', function () {

  var serverUrl = url.format({
    protocol: settings.scheme,
    hostname: settings.host,
    port: settings.port,
    pathname: settings.baseAuthPath
  });

  var requestOptions = {
    url: serverUrl,
    json: true,
    headers: {
      'NodejsServiceKey': settings.serviceKey
    }
  };

  it('should respond to requests', function(done) {
    request.get(serverUrl, function(error, response, body) {
      assert(!error);
      done();
    });
  });

  it('should reject missing service key', function(done) {
    var failingRequestOptions = {
      url: serverUrl,
      json: true,
    };

    request.get(failingRequestOptions, function(error, response, body) {
      assert.equal(body.error, 'Invalid service key.');
      done();
    });
  });

  it('should accept correct service key', function(done) {
    requestOptions.url = serverUrl + 'fakepath';

    request.get(requestOptions, function(error, response, body) {
      assert.equal(response.statusCode, 404);
      done();
    });
  });

  it('should accept content tokens', function(done) {
    requestOptions.url = serverUrl + 'content/token';
    requestOptions.body = {
      channel: 'test_channel',
      token: 'mytoken'
    };

    request.post(requestOptions, function(error, response, body) {
      assert.equal(body.status, 'success');
      done();
    });
  });

  it('should store content tokens', function(done) {
    requestOptions.url = serverUrl + 'health/check';

    request.get(requestOptions, function(error, response, body) {
      assert(body.contentTokens['test_channel']);
      done();
    });
  });
});
