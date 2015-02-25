var NSQDConnection, WriterNSQDConnection, _ref;

_ref = require('./nsqdconnection'), NSQDConnection = _ref.NSQDConnection, WriterNSQDConnection = _ref.WriterNSQDConnection;

module.exports = {
  Reader: require('./reader'),
  Writer: require('./writer'),
  NSQDConnection: NSQDConnection,
  WriterNSQDConnection: WriterNSQDConnection
};

/*
//@ sourceMappingURL=nsq.js.map
*/