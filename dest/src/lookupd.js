var async, dedupeOnHostPort, dedupedRequests, lookup, lookupdRequest, request, url, _;

_ = require('underscore');

async = require('async');

request = require('request');

url = require('url');

/*
lookupdRequest returns the list of producers from a lookupd given a URL to
query.

The callback will not return an error since it's assumed that there might
be transient issues with lookupds.
*/


lookupdRequest = function(url, callback) {
  var options;
  options = {
    url: url,
    method: 'GET',
    json: true,
    timeout: 2000
  };
  return request(options, function(err, response, data) {
    var error, producers, status_code, _ref;
    if (err) {
      callback(null, []);
      return;
    }
    try {
      status_code = data.status_code, (_ref = data.data, producers = _ref.producers);
    } catch (_error) {
      error = _error;
      callback(null, []);
      return;
    }
    if (status_code !== 200) {
      callback(null, []);
      return;
    }
    return callback(null, producers);
  });
};

/*
Takes a list of responses from lookupds and dedupes the nsqd hosts based on
host / port pair.

Arguments:
  results: list of lists of nsqd node objects.
*/


dedupeOnHostPort = function(results) {
  return _.chain(results).flatten().indexBy(function(item) {
    return "" + item.hostname + ":" + item.tcp_port;
  }).values().value();
};

dedupedRequests = function(lookupdEndpoints, urlFn, callback) {
  var endpoint, urls;
  if (_.isString(lookupdEndpoints)) {
    lookupdEndpoints = [lookupdEndpoints];
  }
  urls = (function() {
    var _i, _len, _results;
    _results = [];
    for (_i = 0, _len = lookupdEndpoints.length; _i < _len; _i++) {
      endpoint = lookupdEndpoints[_i];
      _results.push(urlFn(endpoint));
    }
    return _results;
  })();
  return async.map(urls, lookupdRequest, function(err, results) {
    if (err) {
      return callback(err, null);
    } else {
      return callback(null, dedupeOnHostPort(results));
    }
  });
};

/*
Queries lookupds for known nsqd nodes given a topic and returns a deduped list.

Arguments:
  lookupdEndpoints: a string or a list of strings of lookupd HTTP endpoints. eg.
    ['127.0.0.1:4161']
  topic: a string of the topic name.
  callback: with signature `(err, nodes) ->`. `nodes` is a list of objects
    return by lookupds and deduped.
*/


lookup = function(lookupdEndpoints, topic, callback) {
  var endpointURL;
  endpointURL = function(endpoint) {
    var parsedUrl;
    if (endpoint.indexOf('://') === -1) {
      endpoint = "http://" + endpoint;
    }
    parsedUrl = url.parse(endpoint, true);
    if ((!parsedUrl.pathname) || (parsedUrl.pathname === '/')) {
      parsedUrl.pathname = "/lookup";
    }
    parsedUrl.query.topic = topic;
    delete parsedUrl.search;
    return url.format(parsedUrl);
  };
  return dedupedRequests(lookupdEndpoints, endpointURL, callback);
};

module.exports = lookup;

/*
//@ sourceMappingURL=lookupd.js.map
*/