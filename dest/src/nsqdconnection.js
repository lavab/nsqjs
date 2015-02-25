var ConnectionConfig, ConnectionState, Debug, EventEmitter, FrameBuffer, Message, NSQDConnection, NodeState, SnappyStream, UnsnappyStream, WriterConnectionState, WriterNSQDConnection, fs, net, os, tls, version, wire, zlib, _, _ref, _ref1,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __slice = [].slice;

Debug = require('debug');

net = require('net');

os = require('os');

tls = require('tls');

zlib = require('zlib');

fs = require('fs');

EventEmitter = require('events').EventEmitter;

_ref = require('snappystream'), SnappyStream = _ref.SnappyStream, UnsnappyStream = _ref.UnsnappyStream;

_ = require('underscore');

NodeState = require('node-state');

ConnectionConfig = require('./config').ConnectionConfig;

FrameBuffer = require('./framebuffer');

Message = require('./message');

wire = require('./wire');

version = require('./version');

/*
NSQDConnection is a reader connection to a nsqd instance. It manages all
aspects of the nsqd connection with the exception of the RDY count which
needs to be managed across all nsqd connections for a given topic / channel
pair.

This shouldn't be used directly. Use a Reader instead.

Usage:

c = new NSQDConnection '127.0.0.1', 4150, 'test', 'default', 60, 30

c.on NSQDConnection.MESSAGE, (msg) ->
  console.log "Callback [message]: #{msg.attempts}, #{msg.body.toString()}"
  console.log "Timeout of message is #{msg.timeUntilTimeout()}"
  setTimeout (-> console.log "timeout = #{msg.timeUntilTimeout()}"), 5000
  msg.finish()

c.on NSQDConnection.FINISHED, ->
  c.setRdy 1

c.on NSQDConnection.READY, ->
  console.log "Callback [ready]: Set RDY to 100"
  c.setRdy 10

c.on NSQDConnection.CLOSED, ->
  console.log "Callback [closed]: Lost connection to nsqd"

c.on NSQDConnection.ERROR, (err) ->
  console.log "Callback [error]: #{err}"

c.on NSQDConnection.BACKOFF, ->
  console.log "Callback [backoff]: RDY 0"
  c.setRdy 0
  setTimeout (-> c.setRdy 100; console.log 'RDY 100'), 10 * 1000

c.connect()
*/


NSQDConnection = (function(_super) {
  __extends(NSQDConnection, _super);

  NSQDConnection.BACKOFF = 'backoff';

  NSQDConnection.CONNECTED = 'connected';

  NSQDConnection.CLOSED = 'closed';

  NSQDConnection.CONNECTION_ERROR = 'connection_error';

  NSQDConnection.ERROR = 'error';

  NSQDConnection.FINISHED = 'finished';

  NSQDConnection.MESSAGE = 'message';

  NSQDConnection.REQUEUED = 'requeued';

  NSQDConnection.READY = 'ready';

  function NSQDConnection(nsqdHost, nsqdPort, topic, channel, options) {
    var connId;
    this.nsqdHost = nsqdHost;
    this.nsqdPort = nsqdPort;
    this.topic = topic;
    this.channel = channel;
    if (options == null) {
      options = {};
    }
    connId = this.id().replace(':', '/');
    this.debug = Debug("nsqjs:reader:" + this.topic + "/" + this.channel + ":conn:" + connId);
    this.config = new ConnectionConfig(options);
    this.config.validate();
    this.frameBuffer = new FrameBuffer();
    this.statemachine = this.connectionState();
    this.maxRdyCount = 0;
    this.msgTimeout = 0;
    this.maxMsgTimeout = 0;
    this.lastMessageTimestamp = null;
    this.lastReceivedTimestamp = null;
    this.conn = null;
    this.identifyTimeoutId = null;
    this.messageCallbacks = [];
  }

  NSQDConnection.prototype.id = function() {
    return "" + this.nsqdHost + ":" + this.nsqdPort;
  };

  NSQDConnection.prototype.connectionState = function() {
    return this.statemachine || new ConnectionState(this);
  };

  NSQDConnection.prototype.connect = function() {
    var _this = this;
    return process.nextTick(function() {
      _this.conn = net.connect(_this.nsqdPort, _this.nsqdHost, function() {
        _this.statemachine.start();
        _this.emit(NSQDConnection.CONNECTED);
        return _this.identifyTimeoutId = setTimeout(_this.identifyTimeout.bind(_this), 5000);
      });
      return _this.registerStreamListeners(_this.conn);
    });
  };

  NSQDConnection.prototype.registerStreamListeners = function(conn) {
    var _this = this;
    conn.on('data', function(data) {
      return _this.receiveRawData(data);
    });
    conn.on('error', function(err) {
      _this.statemachine.goto('CLOSED');
      return _this.emit('connection_error', err);
    });
    return conn.on('close', function(err) {
      return _this.statemachine.raise('close');
    });
  };

  NSQDConnection.prototype.startTLS = function(callback) {
    var event, options, tlsConn, _i, _len, _ref1,
      _this = this;
    _ref1 = ['data', 'error', 'close'];
    for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
      event = _ref1[_i];
      this.conn.removeAllListeners(event);
    }
    options = {
      socket: this.conn,
      rejectUnauthorized: this.config.tlsVerification
    };
    tlsConn = tls.connect(options, function() {
      _this.conn = tlsConn;
      return typeof callback === "function" ? callback() : void 0;
    });
    return this.registerStreamListeners(tlsConn);
  };

  NSQDConnection.prototype.startDeflate = function(level) {
    this.inflater = zlib.createInflateRaw({
      flush: zlib.Z_SYNC_FLUSH
    });
    this.deflater = zlib.createDeflateRaw({
      level: level,
      flush: zlib.Z_SYNC_FLUSH
    });
    return this.reconsumeFrameBuffer();
  };

  NSQDConnection.prototype.startSnappy = function() {
    this.inflater = new UnsnappyStream();
    this.deflater = new SnappyStream();
    return this.reconsumeFrameBuffer();
  };

  NSQDConnection.prototype.reconsumeFrameBuffer = function() {
    var data;
    if (this.frameBuffer.buffer && this.frameBuffer.buffer.length) {
      data = this.frameBuffer.buffer;
      delete this.frameBuffer.buffer;
      return this.receiveRawData(data);
    }
  };

  NSQDConnection.prototype.setRdy = function(rdyCount) {
    return this.statemachine.raise('ready', rdyCount);
  };

  NSQDConnection.prototype.receiveRawData = function(data) {
    var _this = this;
    if (!this.inflater) {
      return this.receiveData(data);
    } else {
      return this.inflater.write(data, function() {
        var uncompressedData;
        uncompressedData = _this.inflater.read();
        if (uncompressedData) {
          return _this.receiveData(uncompressedData);
        }
      });
    }
  };

  NSQDConnection.prototype.receiveData = function(data) {
    var frame, frameId, payload, _results;
    this.lastReceivedTimestamp = Date.now();
    this.frameBuffer.consume(data);
    _results = [];
    while (frame = this.frameBuffer.nextFrame()) {
      frameId = frame[0], payload = frame[1];
      switch (frameId) {
        case wire.FRAME_TYPE_RESPONSE:
          _results.push(this.statemachine.raise('response', payload));
          break;
        case wire.FRAME_TYPE_ERROR:
          _results.push(this.statemachine.goto('ERROR', new Error(payload.toString())));
          break;
        case wire.FRAME_TYPE_MESSAGE:
          this.lastMessageTimestamp = this.lastReceivedTimestamp;
          _results.push(this.statemachine.raise('consumeMessage', this.createMessage(payload)));
          break;
        default:
          _results.push(void 0);
      }
    }
    return _results;
  };

  NSQDConnection.prototype.identify = function() {
    var identify, key, longName, removableKeys, shortName, _i, _len;
    longName = os.hostname();
    shortName = longName.split('.')[0];
    identify = {
      client_id: this.config.clientId || shortName,
      deflate: this.config.deflate,
      deflate_level: this.config.deflateLevel,
      feature_negotiation: true,
      heartbeat_interval: this.config.heartbeatInterval * 1000,
      long_id: longName,
      msg_timeout: this.config.messageTimeout,
      output_buffer_size: this.config.outputBufferSize,
      output_buffer_timeout: this.config.outputBufferTimeout,
      sample_rate: this.config.sampleRate,
      short_id: shortName,
      snappy: this.config.snappy,
      tls_v1: this.config.tls,
      user_agent: "nsqjs/" + version
    };
    removableKeys = ['msg_timeout', 'output_buffer_size', 'output_buffer_timeout', 'sample_rate'];
    for (_i = 0, _len = removableKeys.length; _i < _len; _i++) {
      key = removableKeys[_i];
      if (identify[key] === null) {
        delete identify[key];
      }
    }
    return identify;
  };

  NSQDConnection.prototype.identifyTimeout = function() {
    return this.statemachine.goto('ERROR', new Error('Timed out identifying with nsqd'));
  };

  NSQDConnection.prototype.clearIdentifyTimeout = function() {
    clearTimeout(this.identifyTimeoutId);
    return this.identifyTimeoutId = null;
  };

  NSQDConnection.prototype.createMessage = function(msgPayload) {
    var msg, msgComponents,
      _this = this;
    msgComponents = wire.unpackMessage(msgPayload);
    msg = (function(func, args, ctor) {
      ctor.prototype = func.prototype;
      var child = new ctor, result = func.apply(child, args);
      return Object(result) === result ? result : child;
    })(Message, __slice.call(msgComponents).concat([this.config.requeueDelay], [this.msgTimeout], [this.maxMsgTimeout]), function(){});
    this.debug("Received message [" + msg.id + "] [attempts: " + msg.attempts + "]");
    msg.on(Message.RESPOND, function(responseType, wireData) {
      _this.write(wireData);
      if (responseType === Message.FINISH) {
        _this.debug("Finished message [" + msg.id + "]");
        return _this.emit(NSQDConnection.FINISHED);
      } else if (responseType === Message.REQUEUE) {
        _this.debug("Requeued message [" + msg.id + "]");
        return _this.emit(NSQDConnection.REQUEUED);
      }
    });
    msg.on(Message.BACKOFF, function() {
      return _this.emit(NSQDConnection.BACKOFF);
    });
    return msg;
  };

  NSQDConnection.prototype.write = function(data) {
    var _this = this;
    if (this.deflater) {
      return this.deflater.write(data, function() {
        return _this.conn.write(_this.deflater.read());
      });
    } else {
      return this.conn.write(data);
    }
  };

  NSQDConnection.prototype.destroy = function() {
    return this.conn.destroy();
  };

  return NSQDConnection;

})(EventEmitter);

ConnectionState = (function(_super) {
  __extends(ConnectionState, _super);

  function ConnectionState(conn) {
    this.conn = conn;
    ConnectionState.__super__.constructor.call(this, {
      autostart: false,
      initial_state: 'CONNECTED',
      sync_goto: true
    });
    this.identifyResponse = null;
  }

  ConnectionState.prototype.log = function(message) {
    this.conn.debug("" + this.current_state_name);
    if (message) {
      return this.conn.debug(message);
    }
  };

  ConnectionState.prototype.afterIdentify = function() {
    return 'SUBSCRIBE';
  };

  ConnectionState.prototype.states = {
    CONNECTED: {
      Enter: function() {
        return this.goto('SEND_MAGIC_IDENTIFIER');
      }
    },
    SEND_MAGIC_IDENTIFIER: {
      Enter: function() {
        this.conn.write(wire.MAGIC_V2);
        return this.goto('IDENTIFY');
      }
    },
    IDENTIFY: {
      Enter: function() {
        var identify;
        identify = this.conn.identify();
        this.conn.debug(identify);
        this.conn.write(wire.identify(identify));
        return this.goto('IDENTIFY_RESPONSE');
      }
    },
    IDENTIFY_RESPONSE: {
      response: function(data) {
        if (data.toString() === 'OK') {
          data = JSON.stringify({
            max_rdy_count: 2500,
            max_msg_timeout: 15 * 60 * 1000,
            msg_timeout: 60 * 1000
          });
        }
        this.identifyResponse = JSON.parse(data);
        this.conn.debug(this.identifyResponse);
        this.conn.maxRdyCount = this.identifyResponse.max_rdy_count;
        this.conn.maxMsgTimeout = this.identifyResponse.max_msg_timeout;
        this.conn.msgTimeout = this.identifyResponse.msg_timeout;
        this.conn.clearIdentifyTimeout();
        if (this.identifyResponse.tls_v1) {
          return this.goto('TLS_START');
        }
        return this.goto('IDENTIFY_COMPRESSION_CHECK');
      }
    },
    IDENTIFY_COMPRESSION_CHECK: {
      Enter: function() {
        var deflate, snappy, _ref1;
        _ref1 = this.identifyResponse, deflate = _ref1.deflate, snappy = _ref1.snappy;
        if (deflate) {
          return this.goto('DEFLATE_START', this.identifyResponse.deflate_level);
        }
        if (snappy) {
          return this.goto('SNAPPY_START');
        }
        return this.goto('AUTH');
      }
    },
    TLS_START: {
      Enter: function() {
        this.conn.startTLS();
        return this.goto('TLS_RESPONSE');
      }
    },
    TLS_RESPONSE: {
      response: function(data) {
        if (data.toString() === 'OK') {
          return this.goto('IDENTIFY_COMPRESSION_CHECK');
        } else {
          return this.goto('ERROR', new Error('TLS negotiate error with nsqd'));
        }
      }
    },
    DEFLATE_START: {
      Enter: function(level) {
        this.conn.startDeflate(level);
        return this.goto('COMPRESSION_RESPONSE');
      }
    },
    SNAPPY_START: {
      Enter: function() {
        this.conn.startSnappy();
        return this.goto('COMPRESSION_RESPONSE');
      }
    },
    COMPRESSION_RESPONSE: {
      response: function(data) {
        if (data.toString() === 'OK') {
          return this.goto('AUTH');
        } else {
          return this.goto('ERROR', new Error('Bad response when enabling compression'));
        }
      }
    },
    AUTH: {
      Enter: function() {
        if (!this.conn.config.authSecret) {
          return this.goto(this.afterIdentify());
        }
        this.conn.write(wire.auth(this.conn.config.authSecret));
        return this.goto('AUTH_RESPONSE');
      }
    },
    AUTH_RESPONSE: {
      response: function(data) {
        this.conn.auth = JSON.parse(data);
        return this.goto(this.afterIdentify());
      }
    },
    SUBSCRIBE: {
      Enter: function() {
        this.conn.write(wire.subscribe(this.conn.topic, this.conn.channel));
        return this.goto('SUBSCRIBE_RESPONSE');
      }
    },
    SUBSCRIBE_RESPONSE: {
      response: function(data) {
        if (data.toString() === 'OK') {
          return this.goto('READY_RECV');
        }
      }
    },
    READY_RECV: {
      Enter: function() {
        return this.conn.emit(NSQDConnection.READY);
      },
      consumeMessage: function(msg) {
        return this.conn.emit(NSQDConnection.MESSAGE, msg);
      },
      response: function(data) {
        if (data.toString() === '_heartbeat_') {
          return this.conn.write(wire.nop());
        }
      },
      ready: function(rdyCount) {
        if (rdyCount > this.conn.maxRdyCount) {
          rdyCount = this.conn.maxRdyCount;
        }
        return this.conn.write(wire.ready(rdyCount));
      },
      close: function() {
        return this.goto('CLOSED');
      }
    },
    READY_SEND: {
      Enter: function() {
        return this.conn.emit(NSQDConnection.READY);
      },
      produceMessages: function(data) {
        var callback, msgs, topic;
        topic = data[0], msgs = data[1], callback = data[2];
        this.conn.messageCallbacks.push(callback);
        if (!_.isArray(msgs)) {
          throw new Error('Expect an array of messages to produceMessages');
        }
        if (msgs.length === 1) {
          return this.conn.write(wire.pub(topic, msgs[0]));
        } else {
          return this.conn.write(wire.mpub(topic, msgs));
        }
      },
      response: function(data) {
        var cb;
        switch (data.toString()) {
          case 'OK':
            cb = this.conn.messageCallbacks.shift();
            return typeof cb === "function" ? cb(null) : void 0;
          case '_heartbeat_':
            return this.conn.write(wire.nop());
        }
      },
      close: function() {
        return this.goto('CLOSED');
      }
    },
    ERROR: {
      Enter: function(err) {
        var cb;
        cb = this.conn.messageCallbacks.shift();
        if (typeof cb === "function") {
          cb(err);
        }
        this.conn.emit(NSQDConnection.ERROR, err);
        return this.goto('CLOSED');
      },
      close: function() {
        return this.goto('CLOSED');
      }
    },
    CLOSED: {
      Enter: function() {
        var cb, err, _i, _len, _ref1;
        if (!this.conn) {
          return;
        }
        err = new Error('nsqd connection closed');
        _ref1 = this.conn.messageCallbacks;
        for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
          cb = _ref1[_i];
          if (typeof cb === "function") {
            cb(err);
          }
        }
        this.conn.messageCallbacks = [];
        this.disable();
        this.conn.destroy();
        this.conn.emit(NSQDConnection.CLOSED);
        return delete this.conn;
      },
      close: function() {}
    }
  };

  ConnectionState.prototype.transitions = {
    '*': {
      '*': function(data, callback) {
        this.log();
        return callback(data);
      },
      CONNECTED: function(data, callback) {
        this.log();
        return callback(data);
      },
      ERROR: function(err, callback) {
        this.log("" + err);
        return callback(err);
      }
    }
  };

  return ConnectionState;

})(NodeState);

/*
c = new NSQDConnectionWriter '127.0.0.1', 4150, 30
c.connect()

c.on NSQDConnectionWriter.CLOSED, ->
  console.log "Callback [closed]: Lost connection to nsqd"

c.on NSQDConnectionWriter.ERROR, (err) ->
  console.log "Callback [error]: #{err}"

c.on NSQDConnectionWriter.READY, ->
  c.produceMessages 'sample_topic', ['first message']
  c.produceMessages 'sample_topic', ['second message', 'third message']
  c.destroy()
*/


WriterNSQDConnection = (function(_super) {
  __extends(WriterNSQDConnection, _super);

  function WriterNSQDConnection(nsqdHost, nsqdPort, options) {
    if (options == null) {
      options = {};
    }
    WriterNSQDConnection.__super__.constructor.call(this, nsqdHost, nsqdPort, null, null, options);
    this.debug = Debug("nsqjs:writer:conn:" + nsqdHost + "/" + nsqdPort);
  }

  WriterNSQDConnection.prototype.connectionState = function() {
    return this.statemachine || new WriterConnectionState(this);
  };

  WriterNSQDConnection.prototype.produceMessages = function(topic, msgs, callback) {
    return this.statemachine.raise('produceMessages', [topic, msgs, callback]);
  };

  return WriterNSQDConnection;

})(NSQDConnection);

WriterConnectionState = (function(_super) {
  __extends(WriterConnectionState, _super);

  function WriterConnectionState() {
    _ref1 = WriterConnectionState.__super__.constructor.apply(this, arguments);
    return _ref1;
  }

  WriterConnectionState.prototype.afterIdentify = function() {
    return 'READY_SEND';
  };

  return WriterConnectionState;

})(ConnectionState);

module.exports = {
  NSQDConnection: NSQDConnection,
  ConnectionState: ConnectionState,
  WriterNSQDConnection: WriterNSQDConnection,
  WriterConnectionState: WriterConnectionState
};

/*
//@ sourceMappingURL=nsqdconnection.js.map
*/