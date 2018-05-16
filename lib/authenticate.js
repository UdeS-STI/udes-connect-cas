var utils = require('./utils');
var debug = require('debug')('cas');

/**
 *
 * @param req
 * @param callback
 * @param options
 * @returns {*}
 */
module.exports = function (req, callback, options) {
  debug('Doing authenticating...');
  if (req.session && req.session.cas && req.session.cas.st) {
    debug(req.session);
    debug('Find st in session');
    if ((options.paths.proxyCallback && req.session.cas.pgt) || !options.paths.proxyCallback) {
      if (!options.paths.proxyCallback) debug('Non-proxy mode, go next()');
      if (options.paths.proxyCallback && req.session.cas.pgt) debug('Proxy-mode, pgt is valid.');
      return callback(function (req, res, next) {
        next();
      });
    } else {
      if (options.paths.proxyCallback && !req.session.cas.pgt) {
        debug('Using proxy-mode CAS, but pgtId is not found in session.');
      }
    }
  } else {
    debug('Can not find st in session', req.session);
  }

  req.session.lastUrl = utils.getOrigin(req, options);
  req.session.returnUrl = req.headers['referer'];

  req.session.save();

  var params = {};

  params.service = utils.getPath('service', options);

  // TODO: renew & gateway is not implement yet
  // if (options.renew === true) {
  //   params.renew = true;
  // } else if (options.gateway === true) {
  //   params.gateway = true;
  // }

  if (options.fromAjax && options.fromAjax.header && req.get(options.fromAjax.header)) {
    debug('Need to redirect, but matched AJAX request, send ' + options.fromAjax.status);
    callback(function (req, res, next) {
      res.status(options.fromAjax.status).send({
        message: 'Login status expired, need refresh path'
      });
    });
  } else {
    var loginPath;
    if (options.paths.login && typeof options.paths.login === 'function') {
      debug('use function manner for custom config');
      loginPath = options.paths.login(req);
    } else {
      debug('use default manner');
      loginPath = utils.getPath('login', options);
    }
    //loginPath += '&sn=' + req.sn;
    debug('redirect to login page ', loginPath);
    callback(function (req, res, next) {
      res.status(401).send({
        "loginPath": loginPath
      });
      //res.redirect(302, loginPath);
    });
  }
};