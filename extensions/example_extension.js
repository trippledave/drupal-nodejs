/**
 * Example extension.
 */
'use strict';

var exampleExtension = {};

/**
 * Route handler for the custom route.
 */
exampleExtension.exampleRouteHandler = function (req, res) {
  res.send({text: 'Hello world.'});
};

/**
 * Defines custom routes.
 *
 * Each route should specify the following:
 *   path: The path that the route will handle.
 *   type: 'get' or 'post'.
 *   handler: The callback function to call when this route is requested.
 *   auth: If true, the service key will be validated and the handler will only
 *     be called if the key is valid. This will also prepend the baseAuthPath
 *     to the path. E.g. the path /example might become /nodejs/example.
 */
exampleExtension.routes = [
  {
    path: '/example',
    type: 'get',
    auth: false,
    handler: exampleExtension.exampleRouteHandler
  }
];

/**
 * Implements the alterRoutes hook.
 * Use this hook to override routes defined in routes.js.
 */
exampleExtension.alterRoutes = function (routes) {
};

/**
 * Implements the alterSettings hook.
 * Use this hook to override settings defined in the config file, and to add
 * settings specific to this extension.
 */
exampleExtension.alterSettings = function (settings) {
};

/**
 * Implements the setup hook.
 * Called once after the app starts. Use this hook to add custom behavior to the
 * clientManager, and to initialize your extension.
 */
exampleExtension.setup = function (clientManager) {
};

module.exports = exampleExtension;
