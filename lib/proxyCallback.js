var _ = require('lodash');
var utils = require('./utils');
var debug = require('debug')('cas');

/**
 * Receive callback from CAS server, receiving PGTIOU and PGTID from this request, store them somewhere in sessionStore.
 *
 * @param req
 * @param callback
 * @param options
 */
module.exports = function proxyCallback(req, callback, options) {
  debug('Receiving pgtIou from CAS server...');
  debug('req.path', req.path);
  debug('req.query', req.query);

  if (!req.query || !req.query.pgtIou || !req.query.pgtId) {
    debug('Receiving pgtIou from CAS server, but with unexpected pgtIou: ' + req.query.pgtIou + ' or pgtId: ' + req.query.pgtId);
    return callback(function (req, res, next) {
      res.sendStatus(200);
    });
  }

  // TODO: PGTIOU -> PGTID should expire quick
  // _.extend(req.session, {
  //   pgtId: req.query.pgtId
  // })
  return req.sessionStore.set(req.query.pgtIou, {
    pgtId: req.query.pgtId,
    cookie: req.session.cookie
  }, function (err) {
    /* istanbul ignore if */
    if (err) {
      debug('Error happened when trying to store pgtIou in sessionStore.');
      debug(err);

      return callback(function (req, res, next) {
        res.status(500).send({
          message: 'Error happened when trying to store pgtIou in sessionStore.',
          error: err
        });
      });
    }

    debug('Receive and store pgtIou together with pgtId succeed!');

    callback(function (req, res, next) {
      res.sendStatus(200);
    });
  });
};