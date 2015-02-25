var BackoffTimer, ConnectionRdy, ConnectionRdyState, Debug, EventEmitter, NSQDConnection, NodeState, READER_COUNT, ReaderRdy, RoundRobinList, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require('underscore');

Debug = require('debug');

EventEmitter = require('events').EventEmitter;

BackoffTimer = require('./backofftimer');

NodeState = require('node-state');

NSQDConnection = require('./nsqdconnection').NSQDConnection;

RoundRobinList = require('./roundrobinlist');

/*
Maintains the RDY and in-flight counts for a nsqd connection. ConnectionRdy
ensures that the RDY count will not exceed the max set for this connection.
The max for the connection can be adjusted at any time.

Usage:

connRdy = ConnectionRdy conn
connRdy.setConnectionRdyMax 10

conn.on 'message', ->
  # On a successful message, bump up the RDY count for this connection.
  connRdy.raise 'bump'
conn.on 'requeue', ->
  # We're backing off when we encounter a requeue. Wait 5 seconds to try
  # again.
  connRdy.raise 'backoff'
  setTimeout (-> connRdy.raise 'bump'), 5000
*/


ConnectionRdy = (function(_super) {
  __extends(ConnectionRdy, _super);

  ConnectionRdy.READY = 'ready';

  ConnectionRdy.STATE_CHANGE = 'statechange';

  function ConnectionRdy(conn) {
    var connId, readerId,
      _this = this;
    this.conn = conn;
    readerId = "" + this.conn.topic + "/" + this.conn.channel;
    connId = "" + (conn.id().replace(':', '/'));
    this.debug = Debug("nsqjs:reader:" + readerId + ":rdy:conn:" + connId);
    this.maxConnRdy = 0;
    this.inFlight = 0;
    this.lastRdySent = 0;
    this.availableRdy = 0;
    this.statemachine = new ConnectionRdyState(this);
    this.conn.on(NSQDConnection.ERROR, function(err) {
      return _this.log(err);
    });
    this.conn.on(NSQDConnection.MESSAGE, function() {
      if (_this.idleId != null) {
        clearTimeout(_this.idleId);
      }
      _this.idleId = null;
      _this.inFlight += 1;
      return _this.availableRdy -= 1;
    });
    this.conn.on(NSQDConnection.FINISHED, function() {
      return _this.inFlight -= 1;
    });
    this.conn.on(NSQDConnection.REQUEUED, function() {
      return _this.inFlight -= 1;
    });
    this.conn.on(NSQDConnection.READY, function() {
      return _this.start();
    });
  }

  ConnectionRdy.prototype.close = function() {
    return this.conn.destroy();
  };

  ConnectionRdy.prototype.name = function() {
    return String(this.conn.conn.localPort);
  };

  ConnectionRdy.prototype.start = function() {
    this.statemachine.start();
    return this.emit(ConnectionRdy.READY);
  };

  ConnectionRdy.prototype.setConnectionRdyMax = function(maxConnRdy) {
    this.log("setConnectionRdyMax " + maxConnRdy);
    this.maxConnRdy = Math.min(maxConnRdy, this.conn.maxRdyCount);
    return this.statemachine.raise('adjustMax');
  };

  ConnectionRdy.prototype.bump = function() {
    return this.statemachine.raise('bump');
  };

  ConnectionRdy.prototype.backoff = function() {
    return this.statemachine.raise('backoff');
  };

  ConnectionRdy.prototype.isStarved = function() {
    if (!(this.inFlight <= this.maxConnRdy)) {
      throw new Error('isStarved check is failing');
    }
    return this.inFlight === this.lastRdySent;
  };

  ConnectionRdy.prototype.setRdy = function(rdyCount) {
    this.log("RDY " + rdyCount);
    if (rdyCount < 0 || rdyCount > this.maxConnRdy) {
      return;
    }
    this.conn.setRdy(rdyCount);
    return this.availableRdy = this.lastRdySent = rdyCount;
  };

  ConnectionRdy.prototype.log = function(message) {
    if (message) {
      return this.debug(message);
    }
  };

  return ConnectionRdy;

})(EventEmitter);

ConnectionRdyState = (function(_super) {
  __extends(ConnectionRdyState, _super);

  function ConnectionRdyState(connRdy) {
    this.connRdy = connRdy;
    ConnectionRdyState.__super__.constructor.call(this, {
      autostart: false,
      initial_state: 'INIT',
      sync_goto: true
    });
  }

  ConnectionRdyState.prototype.log = function(message) {
    this.connRdy.debug(this.current_state_name);
    if (message) {
      return this.connRdy.debug(message);
    }
  };

  ConnectionRdyState.prototype.states = {
    INIT: {
      bump: function() {
        if (this.connRdy.maxConnRdy > 0) {
          return this.goto('MAX');
        }
      },
      backoff: function() {},
      adjustMax: function() {}
    },
    BACKOFF: {
      Enter: function() {
        return this.connRdy.setRdy(0);
      },
      bump: function() {
        if (this.connRdy.maxConnRdy > 0) {
          return this.goto('ONE');
        }
      },
      backoff: function() {},
      adjustMax: function() {}
    },
    ONE: {
      Enter: function() {
        return this.connRdy.setRdy(1);
      },
      bump: function() {
        return this.goto('MAX');
      },
      backoff: function() {
        return this.goto('BACKOFF');
      },
      adjustMax: function() {}
    },
    MAX: {
      Enter: function() {
        return this.raise('bump');
      },
      bump: function() {
        if (this.connRdy.availableRdy <= this.connRdy.lastRdySent * 0.25) {
          return this.connRdy.setRdy(this.connRdy.maxConnRdy);
        }
      },
      backoff: function() {
        return this.goto('BACKOFF');
      },
      adjustMax: function() {
        this.log("adjustMax RDY " + this.connRdy.maxConnRdy);
        return this.connRdy.setRdy(this.connRdy.maxConnRdy);
      }
    }
  };

  ConnectionRdyState.prototype.transitions = {
    '*': {
      '*': function(data, callback) {
        this.log();
        callback(data);
        return this.connRdy.emit(ConnectionRdy.STATE_CHANGE);
      }
    }
  };

  return ConnectionRdyState;

})(NodeState);

/*
Usage:

backoffTime = 90
heartbeat = 30

[topic, channel] = ['sample', 'default']
[host1, port1] = ['127.0.0.1', '4150']
c1 = new NSQDConnection host1, port1, topic, channel, backoffTime, heartbeat

readerRdy = new ReaderRdy 1, 128
readerRdy.addConnection c1

message = (msg) ->
  console.log "Callback [message]: #{msg.attempts}, #{msg.body.toString()}"
  if msg.attempts >= 5
    msg.finish()
    return

  if msg.body.toString() is 'requeue'
    msg.requeue()
  else
    msg.finish()

discard = (msg) ->
  console.log "Giving up on this message: #{msg.id}"
  msg.finish()

c1.on NSQDConnection.MESSAGE, message
c1.connect()
*/


READER_COUNT = 0;

ReaderRdy = (function(_super) {
  __extends(ReaderRdy, _super);

  ReaderRdy.getId = function() {
    READER_COUNT += 1;
    return READER_COUNT - 1;
  };

  /*
  Parameters:
  - maxInFlight        : Maximum number of messages in-flight across all
                           connections.
  - maxBackoffDuration : The longest amount of time (secs) for a backoff event.
  - readerId           : The descriptive id for the Reader
  - lowRdyTimeout      : Time (secs) to rebalance RDY count among connections
                           during low RDY conditions.
  */


  function ReaderRdy(maxInFlight, maxBackoffDuration, readerId, lowRdyTimeout) {
    this.maxInFlight = maxInFlight;
    this.maxBackoffDuration = maxBackoffDuration;
    this.readerId = readerId;
    this.lowRdyTimeout = lowRdyTimeout != null ? lowRdyTimeout : 1.5;
    this.debug = Debug("nsqjs:reader:" + this.readerId + ":rdy");
    ReaderRdy.__super__.constructor.call(this, {
      autostart: true,
      initial_state: 'ZERO',
      sync_goto: true
    });
    this.id = ReaderRdy.getId();
    this.backoffTimer = new BackoffTimer(0, this.maxBackoffDuration);
    this.backoffId = null;
    this.balanceId = null;
    this.connections = [];
    this.roundRobinConnections = new RoundRobinList([]);
  }

  ReaderRdy.prototype.close = function() {
    var conn, _i, _len, _ref, _results;
    clearTimeout(this.backoffId);
    clearTimeout(this.balanceId);
    _ref = this.connections;
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      conn = _ref[_i];
      _results.push(conn.close());
    }
    return _results;
  };

  ReaderRdy.prototype.pause = function() {
    return this.raise('pause');
  };

  ReaderRdy.prototype.unpause = function() {
    return this.raise('unpause');
  };

  ReaderRdy.prototype.isPaused = function() {
    return this.current_state_name === 'PAUSE';
  };

  ReaderRdy.prototype.log = function(message) {
    this.debug(this.current_state_name);
    if (message) {
      return this.debug(message);
    }
  };

  ReaderRdy.prototype.isStarved = function() {
    var c;
    if (_.isEmpty(this.connections)) {
      return false;
    }
    return !_.isEmpty(((function() {
      var _i, _len, _ref, _results;
      if (c.isStarved()) {
        _ref = this.connections;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          c = _ref[_i];
          _results.push(c);
        }
        return _results;
      }
    }).call(this)));
  };

  ReaderRdy.prototype.createConnectionRdy = function(conn) {
    return new ConnectionRdy(conn);
  };

  ReaderRdy.prototype.isLowRdy = function() {
    return this.maxInFlight < this.connections.length;
  };

  ReaderRdy.prototype.onMessageSuccess = function(connectionRdy) {
    if (!this.isPaused()) {
      if (this.isLowRdy()) {
        return this.balance();
      } else {
        return connectionRdy.bump();
      }
    }
  };

  ReaderRdy.prototype.addConnection = function(conn) {
    var connectionRdy,
      _this = this;
    connectionRdy = this.createConnectionRdy(conn);
    conn.on(NSQDConnection.CLOSED, function() {
      _this.removeConnection(connectionRdy);
      return _this.balance();
    });
    conn.on(NSQDConnection.FINISHED, function() {
      return _this.raise('success', connectionRdy);
    });
    conn.on(NSQDConnection.REQUEUED, function() {
      if (_this.current_state_name !== 'BACKOFF' && !_this.isPaused()) {
        return connectionRdy.bump();
      }
    });
    conn.on(NSQDConnection.BACKOFF, function() {
      return _this.raise('backoff');
    });
    return connectionRdy.on(ConnectionRdy.READY, function() {
      var _ref;
      _this.connections.push(connectionRdy);
      _this.roundRobinConnections.add(connectionRdy);
      _this.balance();
      if (_this.current_state_name === 'ZERO') {
        return _this.goto('MAX');
      } else if ((_ref = _this.current_state_name) === 'TRY_ONE' || _ref === 'MAX') {
        return connectionRdy.bump();
      }
    });
  };

  ReaderRdy.prototype.removeConnection = function(conn) {
    this.connections.splice(this.connections.indexOf(conn), 1);
    this.roundRobinConnections.remove(conn);
    if (this.connections.length === 0) {
      return this.goto('ZERO');
    }
  };

  ReaderRdy.prototype.bump = function() {
    var conn, _i, _len, _ref, _results;
    _ref = this.connections;
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      conn = _ref[_i];
      _results.push(conn.bump());
    }
    return _results;
  };

  ReaderRdy.prototype["try"] = function() {
    return this.balance();
  };

  ReaderRdy.prototype.backoff = function() {
    var conn, delay, onTimeout, _i, _len, _ref,
      _this = this;
    _ref = this.connections;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      conn = _ref[_i];
      conn.backoff();
    }
    if (this.backoffId) {
      clearTimeout(this.backoffId);
    }
    onTimeout = function() {
      _this.log('Backoff done');
      return _this.raise('try');
    };
    delay = new Number(this.backoffTimer.getInterval().valueOf()) * 1000;
    this.backoffId = setTimeout(onTimeout, delay);
    return this.log("Backoff for " + delay);
  };

  ReaderRdy.prototype.inFlight = function() {
    var add;
    add = function(previous, conn) {
      return previous + conn.inFlight;
    };
    return this.connections.reduce(add, 0);
  };

  /*
  Evenly or fairly distributes RDY count based on the maxInFlight across
  all nsqd connections.
  */


  ReaderRdy.prototype.balance = function() {
    /*
    In the perverse situation where there are more connections than max in
    flight, we do the following:
    
    There is a sliding window where each of the connections gets a RDY count
    of 1. When the connection has processed it's single message, then the RDY
    count is distributed to the next waiting connection. If the connection
    does nothing with it's RDY count, then it should timeout and give it's
    RDY count to another connection.
    */

    var c, connMax, i, max, perConnectionMax, rdyRemainder, _i, _j, _k, _len, _len1, _ref, _ref1, _ref2, _results;
    this.log('balance');
    if (this.balanceId != null) {
      clearTimeout(this.balanceId);
      this.balanceId = null;
    }
    max = (function() {
      switch (this.current_state_name) {
        case 'TRY_ONE':
          return 1;
        case 'PAUSE':
          return 0;
        default:
          return this.maxInFlight;
      }
    }).call(this);
    perConnectionMax = Math.floor(max / this.connections.length);
    if (perConnectionMax === 0) {
      _ref = this.connections;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        c = _ref[_i];
        c.backoff();
      }
      _ref1 = this.roundRobinConnections.next(max - this.inFlight());
      for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
        c = _ref1[_j];
        c.setConnectionRdyMax(1);
        c.bump();
      }
      return this.balanceId = setTimeout(this.balance.bind(this), this.lowRdyTimeout * 1000);
    } else {
      rdyRemainder = this.maxInFlight % this.connectionsLength;
      _results = [];
      for (i = _k = 0, _ref2 = this.connections.length; 0 <= _ref2 ? _k < _ref2 : _k > _ref2; i = 0 <= _ref2 ? ++_k : --_k) {
        connMax = perConnectionMax;
        if (rdyRemainder > 0) {
          connMax += 1;
          rdyRemainder -= 1;
        }
        this.connections[i].setConnectionRdyMax(connMax);
        _results.push(this.connections[i].bump());
      }
      return _results;
    }
  };

  /*
  The following events results in transitions in the ReaderRdy state machine:
  1. Adding the first connection
  2. Remove the last connections
  3. Finish event from message handling
  4. Backoff event from message handling
  5. Backoff timeout
  */


  ReaderRdy.prototype.states = {
    ZERO: {
      Enter: function() {
        if (this.backoffId) {
          return clearTimeout(this.backoffId);
        }
      },
      backoff: function() {},
      success: function() {},
      "try": function() {},
      pause: function() {
        return this.goto('PAUSE');
      },
      unpause: function() {}
    },
    PAUSE: {
      Enter: function() {
        var conn, _i, _len, _ref, _results;
        _ref = this.connections;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          conn = _ref[_i];
          _results.push(conn.backoff());
        }
        return _results;
      },
      backoff: function() {},
      success: function() {},
      "try": function() {},
      pause: function() {},
      unpause: function() {
        return this.goto('TRY_ONE');
      }
    },
    TRY_ONE: {
      Enter: function() {
        return this["try"]();
      },
      backoff: function() {
        return this.goto('BACKOFF');
      },
      success: function(connectionRdy) {
        this.backoffTimer.success();
        this.onMessageSuccess(connectionRdy);
        return this.goto('MAX');
      },
      "try": function() {},
      pause: function() {
        return this.goto('PAUSE');
      },
      unpause: function() {}
    },
    MAX: {
      Enter: function() {
        this.balance();
        return this.bump();
      },
      backoff: function() {
        return this.goto('BACKOFF');
      },
      success: function(connectionRdy) {
        this.backoffTimer.success();
        return this.onMessageSuccess(connectionRdy);
      },
      "try": function() {},
      pause: function() {
        return this.goto('PAUSE');
      },
      unpause: function() {}
    },
    BACKOFF: {
      Enter: function() {
        this.backoffTimer.failure();
        return this.backoff();
      },
      backoff: function() {
        this.backoffTimer.failure();
        return this.backoff();
      },
      success: function() {},
      "try": function() {
        return this.goto('TRY_ONE');
      },
      pause: function() {
        return this.goto('PAUSE');
      },
      unpause: function() {}
    }
  };

  ReaderRdy.prototype.transitions = {
    '*': {
      '*': function(data, callback) {
        this.log();
        return callback(data);
      }
    }
  };

  return ReaderRdy;

})(NodeState);

module.exports = {
  ReaderRdy: ReaderRdy,
  ConnectionRdy: ConnectionRdy
};

/*
//@ sourceMappingURL=readerrdy.js.map
*/