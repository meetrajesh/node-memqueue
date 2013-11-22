var memcached = require('memcached'),
    memc = new memcached('localhost:11211'),
    sleep = require('sleep'),
    assert = require('assert'),
    util = require('util'),
    atom = require('atom-js'),
    a = new atom()
;

function memq(q_name) {
    var start_key = 'start_' + q_name,
        end_key = 'end_' + q_name,
        lock_key = 'lock_' + q_name,
        item_key_format = 'item_' + q_name + '_%d';

    memc.set(start_key, 0, 0, function() {});
    memc.set(end_key, 0, 0, function() {});

    var _unlock = function(cb) {
        memc.del(lock_key, cb);
    };

    var _lock = function(cb) {
        // standard spin lock - expire in 2 seconds
        memc.add(lock_key, '1', 2, cb);
    };

    this.push = function(elem, cb) {
        _lock(function() {
            memc.incr(end_key, 1, function(err, i) {
                memc.set(util.format(item_key_format, i), elem, 0, function() {
                    _unlock(function() {
                        if (cb) {
                            cb(elem);
                        }
                    });
                });
            });
        });
    };

    this.pop = function(cb) {
        _lock(function() {
            memc.incr(start_key, 1, function(err, i) {
                memc.get(util.format(item_key_format, i), function(err, elem) {
                    var unlock_cb = function() {
                        cb(elem);
                    }
                    if (elem === false) { // eoq
                        memc.incr(end_key, 1, function(err) {
                            unlock_cb();
                        });
                    } else {
                        unlock_cb();
                    }
                });
            });
        });
    };

    this.peek = function(cb) {
        memc.get(start_key, function(err, i) {
            memc.get(util.format(item_key_format, i+1), function(err, elem) {
                cb(elem);
            });
        });
    }

    this.count = function(cb) {
        _lock(function() {
            memc.get(end_key, function(err, end) {
                memc.get(start_key, function(err, start) {
                    _unlock(function() {
                        cb(end-start);
                    });
                });
            });
        });
    };

    this.is_empty = function(cb) {
        this.count(function(count) {
            cb(count == 0);
        });
    };

    // delete the entire queue
    this.del = function(cb) {
        _lock(function() {
            memc.getMulti([start_key, end_key], function(err, results) {
                var memc_delete = function(i) {
                    if (i < results[end_key]) {
                        memc.del(util.format(item_key_format, i+1), function() {
                            memc_delete(i+1);
                        });
                    } else {
                        memc.set(start_key, results[end_key], 0, function() {
                            _unlock(cb);
                        });
                    }
                }
                memc_delete(results[start_key]);
            });
        });
    };
};

// unit tests
var q1 = new memq('testq1');
var q2 = new memq('testq2');
var q3 = new memq('testq3');

a.chain(
    function(next) {
        q1.count(function(count) {
            assert.equal(count, 0);
            next();
        });
    },
    function(next) {
        q1.is_empty(function(ret) {
            assert.equal(ret, true);
            next();
        });
    },
    function(next) {
        var elemsToPush = ['a', 'b', 'c'];
        var pushFunc = function(elem, cb) {
            if (elem) {
                q1.push(elem, function() {
                    return pushFunc(elemsToPush.shift(), cb)
                });
            } else {
                return cb();
            }
        };
        pushFunc(elemsToPush.shift(), next);
    },
    function(next) {
        q1.count(function(count) {
            assert.equal(count, 3);
            next();
        });
    },
    function(next) {
        q1.is_empty(function(ret) {
            assert.equal(ret, false);
            next();
        });
    },
    function(next) {
        q1.peek(function(elem) {
            assert.equal(elem, 'a');
            next();
        });
    },
    function(next) {
        q1.pop(function(elem) {
            assert.equal(elem, 'a');
            next();
        });
    },
    function(next) {
        q1.count(function(count) {
            assert.equal(count, 2);
            next();
        });
    },
    function(next) {
        q1.pop(function(elem) {
            assert.equal(elem, 'b');
            next();
        });
    },
    function(next) {
        q1.push('d', next);
    },
    function(next) {
        q2.push('a2', next);
    },
    function(next) {
        q1.pop(function(elem) {
            assert.equal(elem, 'c');
            next();
        });
    },
    function(next) {
        q1.peek(function(elem) {
            assert.equal(elem, 'd');
            next();
        });
    },
    function(next) {
        q1.pop(function(elem) {
            assert.equal(elem, 'd');
            next();
        });
    },
    function(next) {
        q1.pop(function(elem) {
            assert.equal(elem, false);
            next();
        });
    },
    function(next) {
        q1.peek(function(elem) {
            assert.equal(elem, false);
            next();
        });
    },
    function(next) {
        q2.pop(function(elem) {
            assert.equal(elem, 'a2');
            next();
        });
    },
    function(next) {
        var elemsToPush = ['a', 'b', 'c'];
        var pushFunc = function(elem, cb) {
            if (elem) {
                q3.push(elem, function() {
                    return pushFunc(elemsToPush.shift(), cb)
                });
            } else {
                return cb();
            }
        };
        pushFunc(elemsToPush.shift(), next);
    },
    function(next) {
        q3.count(function(count) {
            assert.equal(count, 3);
            next();
        });
    },
    function(next) {
        q3.del(function() {
            q3.count(function(count) {
                assert.equal(count, 0);
                next();
            });
        });
    },
    function(next) {
        memc.end();
        next();
    }
);
