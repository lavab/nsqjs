var BigNumber, Int64, JSON_stringify, byteLength, command, validChannelName, validTopicName, _,
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

_ = require('underscore');

Int64 = require('node-int64');

BigNumber = require('bignumber.js');

exports.MAGIC_V2 = '  V2';

exports.FRAME_TYPE_RESPONSE = 0;

exports.FRAME_TYPE_ERROR = 1;

exports.FRAME_TYPE_MESSAGE = 2;

JSON_stringify = function(obj, emit_unicode) {
  var json;
  json = JSON.stringify(obj);
  if (emit_unicode) {
    return json;
  } else {
    return json.replace(/[\u007f-\uffff]/g, function(c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }
};

byteLength = function(msg) {
  if (_.isString(msg)) {
    return Buffer.byteLength(msg);
  } else {
    return msg.length;
  }
};

exports.unpackMessage = function(data) {
  var attempts, body, id, timestamp;
  timestamp = (new Int64(data, 0)).toOctetString();
  timestamp = new BigNumber(timestamp, 16);
  attempts = data.readInt16BE(8);
  id = data.slice(10, 26).toString();
  body = data.slice(26);
  return [id, timestamp, attempts, body];
};

command = function(cmd, body) {
  var buffers, header, lengthBuffer, parameters, parametersStr;
  buffers = [];
  parameters = _.toArray(arguments).slice(2);
  if (parameters.length > 0) {
    parameters.unshift('');
  }
  parametersStr = parameters.join(' ');
  header = cmd + parametersStr + '\n';
  buffers.push(new Buffer(header));
  if (body != null) {
    lengthBuffer = new Buffer(4);
    lengthBuffer.writeInt32BE(byteLength(body), 0);
    buffers.push(lengthBuffer);
    if (_.isString(body)) {
      buffers.push(new Buffer(body));
    } else {
      buffers.push(body);
    }
  }
  return Buffer.concat(buffers);
};

exports.subscribe = function(topic, channel) {
  if (!validTopicName(topic)) {
    throw new Error('Invalid topic name');
  }
  if (!validChannelName(channel)) {
    throw new Error('Invalid channel name');
  }
  return command('SUB', null, topic, channel);
};

exports.identify = function(data) {
  var unexpectedKeys, validIdentifyKeys;
  validIdentifyKeys = ['client_id', 'deflate', 'deflate_level', 'feature_negotiation', 'heartbeat_interval', 'long_id', 'msg_timeout', 'output_buffer_size', 'output_buffer_timeout', 'sample_rate', 'short_id', 'snappy', 'tls_v1', 'user_agent'];
  unexpectedKeys = _.filter(_.keys(data), function(k) {
    return __indexOf.call(validIdentifyKeys, k) < 0;
  });
  if (unexpectedKeys.length) {
    throw new Error("Unexpected IDENTIFY keys: " + unexpectedKeys);
  }
  return command('IDENTIFY', JSON_stringify(data));
};

exports.ready = function(count) {
  if (!_.isNumber(count)) {
    throw new Error("RDY count (" + count + ") is not a number");
  }
  if (!(count >= 0)) {
    throw new Error("RDY count (" + count + ") is not positive");
  }
  return command('RDY', null, count.toString());
};

exports.finish = function(id) {
  if (!(Buffer.byteLength(id) <= 16)) {
    throw new Error("FINISH invalid id (" + id + ")");
  }
  return command('FIN', null, id);
};

exports.requeue = function(id, timeMs) {
  var parameters;
  if (timeMs == null) {
    timeMs = 0;
  }
  if (!(Buffer.byteLength(id) <= 16)) {
    throw new Error("REQUEUE invalid id (" + id + ")");
  }
  if (!_.isNumber(timeMs)) {
    throw new Error("REQUEUE delay time is invalid (" + timeMs + ")");
  }
  parameters = ['REQ', null, id, timeMs];
  return command.apply(null, parameters);
};

exports.touch = function(id) {
  return command('TOUCH', null, id);
};

exports.nop = function() {
  return command('NOP', null);
};

exports.pub = function(topic, data) {
  return command('PUB', data, topic);
};

exports.mpub = function(topic, data) {
  var messages, numMessagesBuffer;
  if (!_.isArray(data)) {
    throw new Error("MPUB requires an array of message");
  }
  messages = _.map(data, function(message) {
    var buffer;
    buffer = new Buffer(4 + byteLength(message));
    buffer.writeInt32BE(byteLength(message), 0);
    if (_.isString(message)) {
      buffer.write(message, 4);
    } else {
      message.copy(buffer, 4, 0, buffer.length);
    }
    return buffer;
  });
  numMessagesBuffer = Buffer(4);
  numMessagesBuffer.writeInt32BE(messages.length, 0);
  messages.unshift(numMessagesBuffer);
  return command('MPUB', Buffer.concat(messages), topic);
};

exports.auth = function(token) {
  return command('AUTH', token);
};

validTopicName = function(topic) {
  var _ref;
  return ((0 < (_ref = topic.length) && _ref < 65)) && (topic.match(/^[\w._-]+(?:#ephemeral)?$/) != null);
};

validChannelName = function(channel) {
  var channelRe, _ref;
  channelRe = /^[\w._-]+(?:#ephemeral)?$/;
  return ((0 < (_ref = channel.length) && _ref < 65)) && (channel.match(channelRe) != null);
};

/*
//@ sourceMappingURL=wire.js.map
*/