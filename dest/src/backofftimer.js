var BackoffTimer, decimal, max, min;

decimal = require('bignumber.js');

min = function(a, b) {
  if (a.lte(b)) {
    return a;
  } else {
    return b;
  }
};

max = function(a, b) {
  if (a.gte(b)) {
    return a;
  } else {
    return b;
  }
};

/*
This is a timer that is smart about backing off exponentially when there
are problems

Ported from pynsq:
  https://github.com/bitly/pynsq/blob/master/nsq/BackoffTimer.py
*/


BackoffTimer = (function() {
  function BackoffTimer(minInterval, maxInterval, ratio, shortLength, longLength) {
    var intervalDelta;
    if (ratio == null) {
      ratio = .25;
    }
    if (shortLength == null) {
      shortLength = 10;
    }
    if (longLength == null) {
      longLength = 250;
    }
    this.minInterval = decimal(minInterval);
    this.maxInterval = decimal(maxInterval);
    ratio = decimal(ratio);
    intervalDelta = decimal(this.maxInterval - this.minInterval);
    this.maxShortTimer = intervalDelta.times(ratio);
    this.maxLongTimer = intervalDelta.times(decimal(1).minus(ratio));
    this.shortUnit = this.maxShortTimer.dividedBy(shortLength);
    this.longUnit = this.maxLongTimer.dividedBy(longLength);
    this.shortInterval = decimal(0);
    this.longInterval = decimal(0);
  }

  BackoffTimer.prototype.success = function() {
    this.shortInterval = this.shortInterval.minus(this.shortUnit);
    this.longInterval = this.longInterval.minus(this.longUnit);
    this.shortInterval = max(this.shortInterval, decimal(0));
    return this.longInterval = max(this.longInterval, decimal(0));
  };

  BackoffTimer.prototype.failure = function() {
    this.shortInterval = this.shortInterval.plus(this.shortUnit);
    this.longInterval = this.longInterval.plus(this.longUnit);
    this.shortInterval = min(this.shortInterval, this.maxShortTimer);
    return this.longInterval = min(this.longInterval, this.maxLongTimer);
  };

  BackoffTimer.prototype.getInterval = function() {
    return this.minInterval.plus(this.shortInterval.plus(this.longInterval));
  };

  return BackoffTimer;

})();

module.exports = BackoffTimer;

/*
//@ sourceMappingURL=backofftimer.js.map
*/