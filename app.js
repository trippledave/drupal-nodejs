/**
 * Node.js Integration for Drupal
 * https://www.drupal.org/project/nodejs
 */
'use strict';

var server = require('./lib/server');

server.start(require('./lib/config-manager'));
