var ConnectionConfig, Debug, EventEmitter, Writer, WriterNSQDConnection, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

Debug = require('debug');

EventEmitter = require('events').EventEmitter;

_ = require('underscore');

ConnectionConfig = require('./config').ConnectionConfig;

WriterNSQDConnection = require('./nsqdconnection').WriterNSQDConnection;

/*
Publish messages to nsqds.

Usage:

w = new Writer '127.0.0.1', 4150
w.connect()

w.on Writer.READY, ->
  # Send a single message
  w.publish 'sample_topic', 'one'
  # Send multiple messages
  w.publish 'sample_topic', ['two', 'three']
w.on Writer.CLOSED, ->
  console.log 'Writer closed'
*/


Writer = (function(_super) {
  __extends(Writer, _super);

  Writer.READY = 'ready';

  Writer.CLOSED = 'closed';

  Writer.ERROR = 'error';

  function Writer(nsqdHost, nsqdPort, options) {
    this.nsqdHost = nsqdHost;
    this.nsqdPort = nsqdPort;
    this.debug = Debug("nsqjs:writer:" + this.nsqdHost + "/" + this.nsqdPort);
    this.config = new ConnectionConfig(options);
    this.config.validate();
    this.debug('Configuration');
    this.debug(this.config);
  }

  Writer.prototype.connect = function() {
    var _this = this;
    this.conn = new WriterNSQDConnection(this.nsqdHost, this.nsqdPort, this.config);
    this.debug('connect');
    this.conn.connect();
    this.conn.on(WriterNSQDConnection.READY, function() {
      _this.debug('ready');
      return _this.emit(Writer.READY);
    });
    this.conn.on(WriterNSQDConnection.CLOSED, function() {
      _this.debug('closed');
      return _this.emit(Writer.CLOSED);
    });
    this.conn.on(WriterNSQDConnection.ERROR, function(err) {
      _this.debug('error', err);
      return _this.emit(Writer.ERROR, err);
    });
    return this.conn.on(WriterNSQDConnection.CONNECTION_ERROR, function(err) {
      _this.debug('error', err);
      return _this.emit(Writer.ERROR, err);
    });
  };

  /*
  Publish a message or a list of messages to the connected nsqd. The contents
  of the messages should either be strings or buffers with the payload encoded.
  
  Arguments:
    topic: A valid nsqd topic.
    msgs: A string, a buffer, a JSON serializable object, or
      a list of string / buffers / JSON serializable objects.
  */


  Writer.prototype.publish = function(topic, msgs, callback) {
    var err, msg;
    if (!this.conn) {
      err = new Error('No active Writer connection to send messages');
    }
    if (!msgs || _.isEmpty(msgs)) {
      err = new Error('Attempting to publish an empty message');
    }
    if (err) {
      if (callback) {
        return callback(err);
      }
      throw err;
    }
    if (!_.isArray(msgs)) {
      msgs = [msgs];
    }
    msgs = (function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = msgs.length; _i < _len; _i++) {
        msg = msgs[_i];
        if (_.isString(msg) || Buffer.isBuffer(msg)) {
          _results.push(msg);
        } else {
          _results.push(JSON.stringify(msg));
        }
      }
      return _results;
    })();
    return this.conn.produceMessages(topic, msgs, callback);
  };

  Writer.prototype.close = function() {
    return this.conn.destroy();
  };

  return Writer;

})(EventEmitter);

module.exports = Writer;

/*
//@ sourceMappingURL=writer.js.map
*/