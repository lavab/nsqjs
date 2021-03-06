var ConnectionConfig, ReaderConfig, url, _, _ref,
  __slice = [].slice,
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; },
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require('underscore');

url = require('url');

ConnectionConfig = (function() {
  var isBareAddress;

  ConnectionConfig.DEFAULTS = {
    authSecret: null,
    clientId: null,
    deflate: false,
    deflateLevel: 6,
    heartbeatInterval: 30,
    maxInFlight: 1,
    messageTimeout: null,
    outputBufferSize: null,
    outputBufferTimeout: null,
    requeueDelay: 90,
    sampleRate: null,
    snappy: false,
    tls: false,
    tlsVerification: true
  };

  function ConnectionConfig(options) {
    if (options == null) {
      options = {};
    }
    options = _.chain(options).pick(_.keys(this.constructor.DEFAULTS)).defaults(this.constructor.DEFAULTS).value();
    _.extend(this, options);
  }

  ConnectionConfig.prototype.isNonEmptyString = function(option, value) {
    if (!(_.isString(value) && value.length > 0)) {
      throw new Error("" + option + " must be a non-empty string");
    }
  };

  ConnectionConfig.prototype.isNumber = function(option, value, lower, upper) {
    if (upper == null) {
      upper = null;
    }
    if (_.isNaN(value) || !_.isNumber(value)) {
      throw new Error("" + option + "(" + value + ") is not a number");
    }
    if (upper) {
      if (!((lower <= value && value <= upper))) {
        throw new Error("" + lower + " <= " + option + "(" + value + ") <= " + upper);
      }
    } else {
      if (!(lower <= value)) {
        throw new Error("" + lower + " <= " + option + "(" + value + ")");
      }
    }
  };

  ConnectionConfig.prototype.isNumberExclusive = function(option, value, lower, upper) {
    if (upper == null) {
      upper = null;
    }
    if (_.isNaN(value) || !_.isNumber(value)) {
      throw new Error("" + option + "(" + value + ") is not a number");
    }
    if (upper) {
      if (!((lower < value && value < upper))) {
        throw new Error("" + lower + " < " + option + "(" + value + ") < " + upper);
      }
    } else {
      if (!(lower < value)) {
        throw new Error("" + lower + " < " + option + "(" + value + ")");
      }
    }
  };

  ConnectionConfig.prototype.isBoolean = function(option, value) {
    if (!_.isBoolean(value)) {
      throw new Error("" + option + " must be either true or false");
    }
  };

  isBareAddress = function(addr) {
    var host, port, _ref;
    _ref = addr.split(':'), host = _ref[0], port = _ref[1];
    return host.length > 0 && port > 0;
  };

  ConnectionConfig.prototype.isBareAddresses = function(option, value) {
    if (!(_.isArray(value) && _.every(value, isBareAddress))) {
      throw new Error("" + option + " must be a list of addresses 'host:port'");
    }
  };

  ConnectionConfig.prototype.isLookupdHTTPAddresses = function(option, value) {
    var isAddr;
    isAddr = function(addr) {
      var parsedUrl, _ref;
      if (addr.indexOf('://') === -1) {
        return isBareAddress(addr);
      }
      parsedUrl = url.parse(addr);
      return ((_ref = parsedUrl.protocol) === 'http:' || _ref === 'https:') && !!parsedUrl.host;
    };
    if (!(_.isArray(value) && _.every(value, isAddr))) {
      throw new Error("" + option + " must be a list of addresses 'host:port' or HTTP/HTTPS URI");
    }
  };

  ConnectionConfig.prototype.conditions = function() {
    return {
      authSecret: [this.isNonEmptyString],
      clientId: [this.isNonEmptyString],
      deflate: [this.isBoolean],
      deflateLevel: [this.isNumber, 0, 9],
      heartbeatInterval: [this.isNumber, 1],
      maxInFlight: [this.isNumber, 1],
      messageTimeout: [this.isNumber, 1],
      outputBufferSize: [this.isNumber, 64],
      outputBufferTimeout: [this.isNumber, 1],
      requeueDelay: [this.isNumber, 0],
      sampleRate: [this.isNumber, 1, 99],
      snappy: [this.isBoolean],
      tls: [this.isBoolean],
      tlsVerification: [this.isBoolean]
    };
  };

  ConnectionConfig.prototype.validateOption = function(option, value) {
    var args, fn, _ref;
    _ref = this.conditions()[option], fn = _ref[0], args = 2 <= _ref.length ? __slice.call(_ref, 1) : [];
    return fn.apply(null, [option, value].concat(__slice.call(args)));
  };

  ConnectionConfig.prototype.validate = function() {
    var keys, option, value;
    for (option in this) {
      value = this[option];
      if (_.isFunction(value)) {
        continue;
      }
      if (_.isNull(value) && this.constructor.DEFAULTS[option] === null) {
        continue;
      }
      keys = ['outputBufferSize', 'outputBufferTimeout'];
      if (__indexOf.call(keys, option) >= 0 && value === -1) {
        continue;
      }
      this.validateOption(option, value);
    }
    if (this.snappy && this.deflate) {
      throw new Error('Cannot use both deflate and snappy');
    }
  };

  return ConnectionConfig;

})();

ReaderConfig = (function(_super) {
  __extends(ReaderConfig, _super);

  function ReaderConfig() {
    _ref = ReaderConfig.__super__.constructor.apply(this, arguments);
    return _ref;
  }

  ReaderConfig.DEFAULTS = _.extend({}, ConnectionConfig.DEFAULTS, {
    lookupdHTTPAddresses: [],
    lookupdPollInterval: 60,
    lookupdPollJitter: 0.3,
    name: null,
    nsqdTCPAddresses: [],
    maxAttempts: 0,
    maxBackoffDuration: 128
  });

  ReaderConfig.prototype.conditions = function() {
    return _.extend({}, ReaderConfig.__super__.conditions.call(this), {
      lookupdHTTPAddresses: [this.isLookupdHTTPAddresses],
      lookupdPollInterval: [this.isNumber, 1],
      lookupdPollJitter: [this.isNumberExclusive, 0, 1],
      name: [this.isNonEmptyString],
      nsqdTCPAddresses: [this.isBareAddresses],
      maxAttempts: [this.isNumber, 0],
      maxBackoffDuration: [this.isNumber, 0]
    });
  };

  ReaderConfig.prototype.validate = function() {
    var addresses, key, pass, _i, _len,
      _this = this;
    addresses = ['nsqdTCPAddresses', 'lookupdHTTPAddresses'];
    for (_i = 0, _len = addresses.length; _i < _len; _i++) {
      key = addresses[_i];
      if (_.isString(this[key])) {
        this[key] = [this[key]];
      }
    }
    ReaderConfig.__super__.validate.apply(this, arguments);
    pass = _.chain(addresses).map(function(key) {
      return _this[key].length;
    }).any(_.identity).value();
    if (!pass) {
      throw new Error("Need to provide either " + (addresses.join(' or ')));
    }
  };

  return ReaderConfig;

})(ConnectionConfig);

module.exports = {
  ConnectionConfig: ConnectionConfig,
  ReaderConfig: ReaderConfig
};

/*
//@ sourceMappingURL=config.js.map
*/