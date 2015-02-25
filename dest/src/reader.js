var Debug, EventEmitter, NSQDConnection, Reader, ReaderConfig, ReaderRdy, RoundRobinList, lookup, request, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require('underscore');

Debug = require('debug');

request = require('request');

EventEmitter = require('events').EventEmitter;

ReaderConfig = require('./config').ReaderConfig;

NSQDConnection = require('./nsqdconnection').NSQDConnection;

ReaderRdy = require('./readerrdy').ReaderRdy;

RoundRobinList = require('./roundrobinlist');

lookup = require('./lookupd');

Reader = (function(_super) {
  __extends(Reader, _super);

  Reader.ERROR = 'error';

  Reader.MESSAGE = 'message';

  Reader.DISCARD = 'discard';

  Reader.NSQD_CONNECTED = 'nsqd_connected';

  Reader.NSQD_CLOSED = 'nsqd_closed';

  function Reader(topic, channel, options) {
    this.topic = topic;
    this.channel = channel;
    this.debug = Debug("nsqjs:reader:" + this.topic + "/" + this.channel);
    this.config = new ReaderConfig(options);
    this.config.validate();
    this.debug('Configuration');
    this.debug(this.config);
    this.roundrobinLookupd = new RoundRobinList(this.config.lookupdHTTPAddresses);
    this.readerRdy = new ReaderRdy(this.config.maxInFlight, this.config.maxBackoffDuration, "" + this.topic + "/" + this.channel);
    this.connectIntervalId = null;
    this.connectionIds = [];
  }

  Reader.prototype.connect = function() {
    var delay, delayedStart, directConnect, interval,
      _this = this;
    interval = this.config.lookupdPollInterval * 1000;
    delay = Math.random() * this.config.lookupdPollJitter * interval;
    if (this.config.nsqdTCPAddresses.length) {
      directConnect = function() {
        var addr, address, port, _i, _len, _ref, _ref1, _results;
        if (_this.isPaused()) {
          return;
        }
        if (_this.connectionIds.length < _this.config.nsqdTCPAddresses.length) {
          _ref = _this.config.nsqdTCPAddresses;
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            addr = _ref[_i];
            _ref1 = addr.split(':'), address = _ref1[0], port = _ref1[1];
            _results.push(_this.connectToNSQD(address, Number(port)));
          }
          return _results;
        }
      };
      delayedStart = function() {
        return _this.connectIntervalId = setInterval(directConnect.bind(_this), interval);
      };
      directConnect();
      return setTimeout(delayedStart, delay);
    } else {
      delayedStart = function() {
        return _this.connectIntervalId = setInterval(_this.queryLookupd.bind(_this), interval);
      };
      this.queryLookupd();
      return setTimeout(delayedStart, delay);
    }
  };

  Reader.prototype.close = function() {
    clearInterval(this.connectIntervalId);
    return this.readerRdy.close();
  };

  Reader.prototype.pause = function() {
    this.debug('pause');
    return this.readerRdy.pause();
  };

  Reader.prototype.unpause = function() {
    this.debug('unpause');
    return this.readerRdy.unpause();
  };

  Reader.prototype.isPaused = function() {
    return this.readerRdy.isPaused();
  };

  Reader.prototype.queryLookupd = function() {
    var endpoint,
      _this = this;
    if (this.isPaused()) {
      return;
    }
    endpoint = this.roundrobinLookupd.next();
    return lookup(endpoint, this.topic, function(err, nodes) {
      var n, _i, _len, _results;
      if (!err) {
        _results = [];
        for (_i = 0, _len = nodes.length; _i < _len; _i++) {
          n = nodes[_i];
          _results.push(_this.connectToNSQD(n.broadcast_address, n.tcp_port));
        }
        return _results;
      }
    });
  };

  Reader.prototype.connectToNSQD = function(host, port) {
    var conn;
    this.debug("connecting to " + host + ":" + port);
    conn = new NSQDConnection(host, port, this.topic, this.channel, this.config);
    if (this.connectionIds.indexOf(conn.id()) !== -1) {
      return;
    }
    this.connectionIds.push(conn.id());
    this.registerConnectionListeners(conn);
    this.readerRdy.addConnection(conn);
    return conn.connect();
  };

  Reader.prototype.registerConnectionListeners = function(conn) {
    var _this = this;
    conn.on(NSQDConnection.CONNECTED, function() {
      _this.debug(Reader.NSQD_CONNECTED);
      return _this.emit(Reader.NSQD_CONNECTED, conn.nsqdHost, conn.nsqdPort);
    });
    conn.on(NSQDConnection.ERROR, function(err) {
      _this.debug(Reader.ERROR);
      _this.debug(err);
      return _this.emit(Reader.ERROR, err);
    });
    conn.on(NSQDConnection.CONNECTION_ERROR, function(err) {
      _this.debug(Reader.ERROR);
      _this.debug(err);
      return _this.emit(Reader.ERROR, err);
    });
    conn.on(NSQDConnection.CLOSED, function() {
      var index;
      _this.debug(Reader.NSQD_CLOSED);
      index = _this.connectionIds.indexOf(conn.id());
      if (index === -1) {
        return;
      }
      _this.connectionIds.splice(index, 1);
      return _this.emit(Reader.NSQD_CLOSED, conn.nsqdHost, conn.nsqdPort);
    });
    return conn.on(NSQDConnection.MESSAGE, function(message) {
      return _this.handleMessage(message);
    });
  };

  Reader.prototype.handleMessage = function(message) {
    var _this = this;
    return process.nextTick(function() {
      var autoFinishMessage, numDiscardListeners, _ref;
      autoFinishMessage = (0 < (_ref = _this.config.maxAttempts) && _ref <= message.attempts);
      numDiscardListeners = _this.listeners(Reader.DISCARD).length;
      if (autoFinishMessage && numDiscardListeners > 0) {
        _this.emit(Reader.DISCARD, message);
      } else {
        _this.emit(Reader.MESSAGE, message);
      }
      if (autoFinishMessage) {
        return message.finish();
      }
    });
  };

  return Reader;

})(EventEmitter);

module.exports = Reader;

/*
//@ sourceMappingURL=reader.js.map
*/