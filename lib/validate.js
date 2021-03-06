var queryString = require('query-string');
var xml2js = require('xml2js').parseString;
var stripPrefix = require('xml2js/lib/processors').stripPrefix;
var http = require('http');
var utils = require('./utils');
var debug = require('debug')('cas');

/**
 * Validate a ticket from CAS server
 *
 * @param req
 * @param res
 * @param callback
 * @param options
 */
function validate(req, res, callback, options) {
  // check ticket first`
  var lastUrl = utils.getLastUrl(req, options);
  var ticket = req.query && req.query.ticket || null;
  var session = req.session;

  debug('Start validating ticket...');

  if (ticket) {
    debug('Find ticket in query', ticket);
    if (session && session.cas && session.cas.st && session.cas.st === ticket) {
      debug('Ticket in query is equal to the one in session, go last url: ' + lastUrl);
      return callback(function (req, res, next) {
        res.redirect(302, lastUrl);
      });
    }

    validateTicket(req, options, function (err, response) {
      if (err) {
        return callback(function (req, res, next) {
          res.status(500).send({
            message: 'Receive response from cas when validating ticket, but request failed because an error happened.',
            error: err.message
          });
        });
      }

      debug('Receive from CAS server, status: ' + response.status);
      if (response.status === 200) {

        parseCasResponse(response.body, function (err, info) {
          if (err) {
            var resBody = {
              error: err
            };
            if (info && info.message) resBody.message = info.message;
            return callback(function (req, res, next) {
              res.status(500).send(resBody);
            });
          }

          if (!info || (info && !info.user)) {
            return callback(function (req, res, next) {
              res.status(401).send({
                message: 'Receive response from CAS when validating ticket, but the validation is failed.'
              });
            })
          }

          var pgtIou = info.proxyGrantingTicket;

          delete info.proxyGrantingTicket;

          req.session.cas = info;

          var ticket = req.query.ticket;

          req.session.cas.st = ticket;

          if (options.slo) {
            req.sessionStore.set(ticket, {
              sid: req.session.id,
              cookie: req.session.cookie
            }, function (err) {
              if (err) {
                debug('Trying to store ticket in sessionStore for ssoff failed!');
                debug(err);
              }
            });
          }

          if (!pgtIou) {
            if (options.paths.proxyCallback) {
              debug('pgtUrl is specific, but havn\'t find pgtIou from CAS validation response! Response status 401.');
              return callback(function (req, res, next) {
                res.status(401).send({
                  message: 'pgtUrl is specific, but havn\'t find pgtIou from CAS validation response!'
                });
              });
            } else {
              debug('None-proxy mode, validate ticket succeed, redirecting to lastUrl: ' + lastUrl);
              req.session.save(function (err) {
                /* istanbul ignore if */
                if (err) {
                  debug('Trying to save session failed!');
                  debug(err);
                  return callback(function (req, res, next) {
                    res.status(500).send({
                      message: 'Trying to save session failed!',
                      error: err
                    });
                  });
                }

                lastUrl = getLastUrl(req, res, options, lastUrl);
                return callback(function (req, res, next) {
                  res.redirect(302, lastUrl);
                });
              });
            }

            return;
          }

          retrievePGTFromPGTIOU(req, res, callback, pgtIou, options);
        });
      } else {
        debug('Receive response from cas when validating ticket, but request failed with status code: ' + response.status + '!');
        callback(function (req, res, next) {
          res.status(401).send({
            message: 'Receive response from cas when validating ticket, but request failed with status code: ' + response.status + '.'
          });
        });
      }
    });
  } else {
    lastUrl = utils.getLastUrl(req, options);
    debug('Can\' find ticket in query, redirect to last url: ' + lastUrl);
    return callback(function (req, res, next) {
      res.redirect(302, lastUrl);
    });
  }
}

module.exports = validate;

/**
 * Validate ticket from CAS server
 *
 * @param req
 * @param options
 * @param callback
 */
function validateTicket(req, options, callback) {
  var query = {
    service: utils.getPath('service', options),
    ticket: req.query.ticket
  };

  if (options.paths.proxyCallback) query.pgtUrl = utils.getPath('pgtUrl', options);

  var casServerValidPath = utils.getPath('serviceValidate', options) + '?' + queryString.stringify(query);

  debug('Sending request to: "' + casServerValidPath + '" to validate ticket.');
  var startTime = Date.now();
  utils.getRequest(casServerValidPath, function (err, response) {
    debug('|GET|' + casServerValidPath + '|' + (err ? 500 : response.status) + "|" + (Date.now() - startTime));
    if (err) {
      debug('Error when sending request to CAS server, error: ', err.toString());
      debug(err);
      return callback(err);
    }

    callback(null, response);
  });
}

/**
 * parseCasResponse XML
 *
 * @param casBody
 * @param callback
 */
function parseCasResponse(casBody, callback) {
  xml2js(casBody, {
    explicitRoot: false,
    tagNameProcessors: [stripPrefix]
  }, function (err, serviceResponse) {
    if (err) {
      debug('Failed to parse CAS server response when trying to validate ticket.');
      debug(err);
      return callback(err, {
        message: 'Failed to parse CAS server response when trying to validate ticket.'
      });
    }

    if (!serviceResponse) {
      debug('Invalid CAS server response.');
      return callback(new Error('Invalid CAS server response, serviceResponse empty.'), {
        message: 'Invalid CAS server response, serviceResponse empty.'
      });
    }

    var success = serviceResponse.authenticationSuccess && serviceResponse.authenticationSuccess[0];

    if (!success) {
      debug('Receive response from CAS when validating ticket, but the validation is failed.');
      debug('Cas response:', serviceResponse);
      return callback(null, {});
    }

    var casResponse = {};
    for (var casProperty in success) {
      casResponse[casProperty] = success[casProperty][0];
    }

    return callback(null, casResponse);
  })
}

/**
 * Find PGT by PGTIOU
 *
 * @param req
 * @param res
 * @param callback
 * @param pgtIou
 * @param options
 */
function retrievePGTFromPGTIOU(req, res, callback, pgtIou, options) {
  debug('Trying to retrieve pgtId from pgtIou...');

  req.sessionStore.get(pgtIou, function (err, session) {
    /* istanbul ignore if */
    if (err) {
      debug('Get pgtId from sessionStore failed!');
      debug(err);
      req.sessionStore.destroy(pgtIou);
      return callback(function (req, res, next) {
        res.status(500).send({
          message: 'Get pgtId from sessionStore failed!',
          error: err
        });
      });
    }

    if (session && session.pgtId) {
      var lastUrl = utils.getLastUrl(req, options);
      if (!req.session || req.session && !req.session.cas) {
        debug('Here session.cas should not be empty!', req.session);
        req.session.cas = {};
      }

      req.session.cas.pgt = session.pgtId;

      req.session.save(function (err) {
        if (err) {
          debug('Trying to save session failed!');
          debug(err);
          return callback(function (req, res, next) {
            res.status(500).send({
              message: 'Trying to save session failed!',
              error: err
            });
          });
        }

        req.sessionStore.destroy(pgtIou);

        //belj1822
        lastUrl = (req.session && req.session.returnUrl) ? req.session.returnUrl : getLastUrl(req, res, options, lastUrl);

        debug('CAS proxy mode login and validation succeed, pgtId finded. Redirecting to lastUrl: ' + lastUrl);
        return callback(function (req, res, next) {
          res.redirect(302, lastUrl);
        });
      });
    } else {
      debug('CAS proxy mode login and validation succeed, but can\' find pgtId from pgtIou: `' + pgtIou + '`, maybe something wrong with sessionStroe!');
      callback(function (req, res, next) {
        res.status(401).send({
          message: 'CAS proxy mode login and validation succeed, but can\' find pgtId from pgtIou: `' + pgtIou + '`, maybe something wrong with sessionStroe!'
        });
      });
    }
  });
}

function getLastUrl(req, res, options, lastUrl) {
  if (typeof options.redirect === 'function') {
    var customRedirectUrl;
    if ((customRedirectUrl = options.redirect(req, res)) && typeof customRedirectUrl === 'string') {
      debug('Specific options.redirect matched, redirect to customize location: ', customRedirectUrl);
      return customRedirectUrl;
    }
  }
  return lastUrl;
}