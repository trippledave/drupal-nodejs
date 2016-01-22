var assert = require('assert');
var url = require('url');
var request = require('request');
var io = require('socket.io-client');
var configManager = require('../lib/config-manager');
var server = require('../lib/server');

describe('Server app', function () {
  this.timeout(5000);

  var client;
  var settings = {
    scheme: 'http',
    port: 8080,
    host: 'localhost',
    resource: '/socket.io',
    serviceKey: '__LOL_TESTING__',
    debug: false,
    baseAuthPath: '/nodejs/',
    extensions: [],
    clientsCanWriteToChannels: false,
    clientsCanWriteToClients: false,
    transports: ['websocket', 'polling'],
    jsMinification: true,
    jsEtag: true,
    backend: {
      host: 'localhost',
      scheme: 'http',
      port: 80,
      basePath: '/',
      strictSSL: false,
      messagePath: 'nodejs/message',
      httpAuth: ''
    },
    logLevel: 1
  };

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

  before(function () {
    configManager.setSettings(settings);
    server.start(configManager);
  });

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

  it('should create channel', function(done) {
    requestOptions.url = serverUrl + 'channel/add/test_channel_2';

    request.post(requestOptions, function(error, response, body) {
      assert.equal(body.status, 'success');
      done();
    });
  });

  it('should persist channel', function(done) {
    requestOptions.url = serverUrl + 'channel/check/test_channel_2';

    request.get(requestOptions, function(error, response, body) {
      assert.equal(body.status, 'success');
      done();
    });
  });

  it('should accept client connections', function(done) {
    client = io(settings.scheme + '://' + settings.host + ':' + settings.port);

    client.on('connect', function() {
      done();
    });

    client.on('connect_error', function() {
      assert.fail(true, false, 'Connection error');
      done();
    });

    client.on('connect_timeout', function() {
      assert.fail(true, false, 'Connection timeout');
      done();
    });
  });

  it('should broadcast messages', function(done) {
    requestOptions.url = serverUrl + 'publish';
    requestOptions.body = {
      channel: 'test_channel',
      text: 'test_message',
      broadcast: 1
    };

    client.on('message', function(message) {
      assert.equal(message.text, 'test_message');
      done();
    });

    request.post(requestOptions, function(error, response, body) {
      assert.equal(body.status, 'success');
    });
  });

});
