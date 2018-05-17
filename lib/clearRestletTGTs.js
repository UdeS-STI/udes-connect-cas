var globalStore = require('./globalStoreCache');
var utils = require('./utils');
var debug = require('debug')('cas');

function clearRestletTGTs(options, callback) {
  debug('Start to clear restlet tgts');
  var tgts = globalStore.getAll();
  var deleteTgtPath = utils.getPath('restletIntegration', options);

  var queueArr = [],
    index = 0;

  for (var i in tgts) {
    queueArr.push(deleteTgtPath + '/' + tgts[i]);
  }

  execQueue(queueArr[index], function next(err, response) {
    if (!err && !response) {
      globalStore.clear();
      return callback();
    }

    if (err) {
      debug('Request to delete TGT failed!');
      debug(err);
    }

    index++;
    execQueue(queueArr[index], next);
  });


  function execQueue(path, next) {
    if (!path) return next();
    var startTime = Date.now();
    utils.deleteRequest(path, function (err, response) {
      debug('|DELETE|' + path + '|' + (err ? 500 : response.status) + "|" + (Date.now() - startTime));
      if (err) next(err);

      next(null, response);
    });
  }
}

module.exports = clearRestletTGTs;