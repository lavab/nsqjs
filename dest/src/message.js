var EventEmitter, Message, wire, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require('underscore');

wire = require('./wire');

EventEmitter = require('events').EventEmitter;

Message = (function(_super) {
  __extends(Message, _super);

  Message.BACKOFF = 'backoff';

  Message.RESPOND = 'respond';

  Message.FINISH = 0;

  Message.REQUEUE = 1;

  Message.TOUCH = 2;

  function Message(id, timestamp, attempts, body, requeueDelay, msgTimeout, maxMsgTimeout) {
    var trackTimeout,
      _this = this;
    this.id = id;
    this.timestamp = timestamp;
    this.attempts = attempts;
    this.body = body;
    this.requeueDelay = requeueDelay;
    this.msgTimeout = msgTimeout;
    this.maxMsgTimeout = maxMsgTimeout;
    this.hasResponded = false;
    this.receivedOn = Date.now();
    this.lastTouched = this.receivedOn;
    this.timedOut = false;
    (trackTimeout = function() {
      var hard, soft;
      if (_this.hasResponded) {
        return;
      }
      soft = _this.timeUntilTimeout();
      hard = _this.timeUntilTimeout(true);
      _this.timedOut = !soft || !hard;
      if (!_this.timedOut) {
        return setTimeout(trackTimeout, Math.min(soft, hard));
      }
    })();
  }

  Message.prototype.json = function() {
    var err;
    if (this.parsed == null) {
      try {
        this.parsed = JSON.parse(this.body);
      } catch (_error) {
        err = _error;
        throw new Error("Invalid JSON in Message");
      }
    }
    return this.parsed;
  };

  Message.prototype.timeUntilTimeout = function(hard) {
    var delta;
    if (hard == null) {
      hard = false;
    }
    if (this.hasResponded) {
      return null;
    }
    delta = hard ? this.receivedOn + this.maxMsgTimeout - Date.now() : this.lastTouched + this.msgTimeout - Date.now();
    if (delta > 0) {
      return delta;
    } else {
      return null;
    }
  };

  Message.prototype.finish = function() {
    return this.respond(Message.FINISH, wire.finish(this.id));
  };

  Message.prototype.requeue = function(delay, backoff) {
    if (delay == null) {
      delay = this.requeueDelay;
    }
    if (backoff == null) {
      backoff = true;
    }
    this.respond(Message.REQUEUE, wire.requeue(this.id, delay));
    if (backoff) {
      return this.emit(Message.BACKOFF);
    }
  };

  Message.prototype.touch = function() {
    this.lastTouched = Date.now();
    return this.respond(Message.TOUCH, wire.touch(this.id));
  };

  Message.prototype.respond = function(responseType, wireData) {
    var _this = this;
    if (this.hasResponded) {
      return;
    }
    return process.nextTick(function() {
      if (responseType !== Message.TOUCH) {
        _this.hasResponded = true;
      } else {
        _this.lastTouched = Date.now();
      }
      return _this.emit(Message.RESPOND, responseType, wireData);
    });
  };

  return Message;

})(EventEmitter);

module.exports = Message;

/*
//@ sourceMappingURL=message.js.map
*/