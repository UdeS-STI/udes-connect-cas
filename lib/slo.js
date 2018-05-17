var utils = require('./utils');
var debug = require('debug')('cas');

/**
 * Handle single-signed off request from CAS server
 *
 * @param req
 * @param callback
 * @param options
 */
module.exports = function (req, callback, options) {
  /* istanbul ignore if */
  if (!req.sessionStore) {
    var error = new Error('req.sessionStore is not defined, maybe you havn\'t initialize cookie session.');
    debug(error.stack);
    return callback(function (req, res, next) {
      res.status(500).send({
        message: error.message
      });
    });
  }

  debug('Receive slo request... Trying to logout.');

  var body = '';
  req.on('data', function (chunk) {
    body += chunk;
  });
  req.on('end', function () {
    if (!/<samlp:SessionIndex>(.*)<\/samlp:SessionIndex>/.exec(body)) {
      debug('Slo request receive, but body content is not valid');

      // 响应已经end了, 没next了
      return callback(function (req, res, next) {
        res.sendStatus(202);
      });
    }
    var st = RegExp.$1;

    req.sessionStore.get(st, function (err, result) {
      /* istanbul ignore if */
      if (err) {
        debug('Trying to ssoff, but get st from session failed!');
        debug(err);
        return callback(function (req, res, next) {
          res.sendStatus(202);
        });
      }

      /* istanbul ignore else */
      if (result && result.sid) {
        debug('Find sid by st succeed, trying to destroy it.', 'st', st, 'sessionId', result.sid);
        req.sessionStore.destroy(result.sid, function (err) {
          /* istanbul ignore if */
          if (err) {
            debug('Error when destroy session for id: ', result.sid);
            debug(err);
            return callback(function (req, res, next) {
              res.sendStatus(202);
            });
          }

          finalHandler(req, callback, st, true);
        });
      } else {
        debug('Can not find sid by st', result);
        finalHandler(req, callback, st, false);
      }
    });
  });

  function finalHandler(req, callback, st, isSucceed) {
    req.sessionStore.destroy(st, function (err) {
      /* istanbul ignore if */
      if (err) {
        debug('Error when destroy st in session store. ', st);
        debug(err);
      }

      callback(function (req, res, next) {
        res.sendStatus(isSucceed ? 200 : 202);
      });
    });
  }
};