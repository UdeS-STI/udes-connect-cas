var utils = require('./utils');
var queryString = require('query-string');
var debug = require('debug')('cas');

/**
 * Parse proxy ticket from /proxy response
 *
 * @param body
 * @returns {string} proxy ticket
 */
function parseCasResponse(body) {
  body = body || '';
  var pt = '';
  if (/<cas:proxySuccess/.exec(body)) {
    if (/<cas:proxyTicket>(.*)<\/cas:proxyTicket>/.exec(body)) {
      pt = RegExp.$1;
    }
  }

  return pt;
}

/**
 * Get a proxy ticket from CAS server.
 *
 * @context {ConnectCas}
 * @param req
 * @param {Object}   proxyOptions
 * @param {String}   proxyOptions.targetService   (Required)
 * @param {Boolean}  proxyOptions.disableCache    Whether to force disable cache and to request a new one.
 * @param {Boolean}  proxyOptions.renew           Don't use cache, request a new one, reset it to cache
 * @param {String}   proxyOptions.specialPgt
 * @param {Function} proxyOptions.retryHandler
 * @param callback
 * @returns {*}
 */
module.exports = function (req, res, proxyOptions, callback) {
  var options = this.options;
  var ptStore = this.ptStore;

  var disableCache = proxyOptions.disableCache;
  var targetService = proxyOptions.targetService;
  var specialPgt = proxyOptions.specialPgt;
  var retryHandler = proxyOptions.retryHandler;
  var renew = proxyOptions.renew;

  if (!targetService) {
    return callback(new Error('Unexpected targetService of ' + targetService + ', a String is expired.'));
  }

  if (specialPgt) {
    debug('specialPgt is set, use specialPgt: ', specialPgt);
  }

  var pgt = specialPgt || (req.session && req.session.cas && req.session.cas.pgt);

  if (!pgt) {
    return callback(new Error('Unexpected pgt of ' + pgt + ', a String is expired.'));
  }


  var params = {};
  params.targetService = targetService;
  params.pgt = pgt;

  var proxyPath = utils.getPath('proxy', options) + '?' + queryString.stringify(params);

  var isMatchFilter = (options.cache && options.cache.filter && typeof options.cache.filter.some === 'function') ? options.cache.filter.some(function (rule) {
    return utils.isMatchRule(req, targetService, rule);
  }) : false;

  if (options.cache.filter && typeof options.cache.filter.some !== 'function') {
    debug('options.cache.filter is set, but it is not an array! Will be ignore directly.');
  }

  if (isMatchFilter) {
    debug('Matched filer rules, ignore cache');
  }

  // Decide whether to use cached proxy ticket
  if (disableCache || !options.cache.enable || isMatchFilter || renew) {
    // Not to use cache
    if (disableCache) {
      debug('Enforce request pt, ignore cache');
    } else if (renew) {
      debug('renew is true, refetch a new pt');
    }
    requestPT(proxyPath, function (err, pt) {
      if (err && err.message.indexOf('Request for PT succeed, but the response is invalid') !== -1) {
        debug('As pgt is invalid, so just redirect to login page!');
        //Do not remove session and let it be updated, otherwise lastUrl is set back to '/'
        //req.session && req.session.destroy && req.session.destroy();
        //return res.redirect(utils.getPath('login', options));
        return res.status(401).send({
          "loginPath": utils.getPath('login', options)
        });
      }
      if (renew) {
        debug('Refetch a new pt succeed, pt: ' + pt + '. Try store it in cache.');
        return getPtHandler(err, pt);
      }
      /* istanbul ignore if */
      if (err) return callback(err);
      callback(null, pt);
    }, retryHandler);
  } else {
    debug('Using cached pt, trying to find cached pt for service: ', targetService);
    // Use cache
    ptStore.get(req, targetService, function (err, pt) {
      /* istanbul ignore if */
      if (err) {
        debug('Error when trying to find cached pt.');
        debug(err);
        return callback(err);
      }
      if (pt) {
        debug('Find cached pt succeed, ', pt);
        return callback(null, pt);
      }

      debug('Can not find cached pt, trying to request a new one again.');
      // Can not find pt from pt, request a new one
      requestPT(proxyPath, getPtHandler, retryHandler);
    });
  }

  function getPtHandler(err, pt) {
    /* istanbul ignore if */
    if (err) {
      debug('Error happened when sending request to: ' + proxyPath);
      if (err.message.indexOf('Request for PT succeed, but the response is invalid') !== -1) {
        debug('As pgt is invalid, so just redirect to login page!');
        //Do not remove session and let it be updated, otherwise lastUrl is set back to '/'
        //req.session && req.session.destroy && req.session.destroy();
        // return res.redirect(utils.getPath('login', options));
        return res.status(401).send({
          "loginPath": utils.getPath('login', options)
        });
      }
      debug(err);
      return callback(err);
    }

    debug('Request for a pt succeed, trying to store them to cache.');
    ptStore.set(req, targetService, pt, function (err) {
      /* istanbul ignore if */
      if (err) {
        debug('Trying to store pt in pt cache fail!');
        debug(err);
        // Store failed should not affect the result
        return callback(null, pt);
      }

      debug('Store pt in cache succeed!');
      callback(null, pt);
    });
  }

  /**
   * Request a proxy ticket
   * @param req
   * @param path
   * @param callback
   * @param {Function} retryHandler If this callback is set, it will be called only if request failed due to authentication issue.
   */
  function requestPT(path, callback, retryHandler) {
    debug('Trying to request proxy ticket from ', proxyPath);
    var startTime = Date.now();
    utils.getRequest(path, function (err, response) {
      /* istanbul ignore if */
      debug('|GET|' + path + '|' + (err ? 500 : response.status) + "|" + (Date.now() - startTime));
      if (err) {
        debug('Error happened when sending request to: ' + path);
        debug(err);
        return callback(err);
      }

      if (response.status !== 200) {
        debug('Request fail when trying to get proxy ticket', response);
        if (typeof retryHandler === 'function') return retryHandler(err);

        return callback(new Error('Request fail when trying to get proxy ticket, response status: ' + response.status +
          ', response body: ' + response.body));
      }

      var pt = parseCasResponse(response.body);

      if (pt) {
        debug('Request proxy ticket succeed, receive pt: ', pt);
        callback(null, pt);
      } else {
        debug('Can\' get pt from get proxy ticket response.');
        debug('Request for PT succeed, but response is invalid, response: ', response.body);
        if (typeof retryHandler === 'function') return retryHandler(new Error('Request for PT succeed, but response is invalid, response: ' + response.body));
        return callback(new Error('Request for PT succeed, but the response is invalid, response: ' + response.body));
      }
    });
  }
};