"use strict";
var Memcached = require('memcached');
var sleep = require('sleep');
var assert = require('assert');

function memq (q_name) {
	var memc,
		start_key = 'start_' + q_name,
		end_key = 'end_' + q_name,
		lock_key = 'lock_' + q_name,
		item_key_format = 'item_' + q_name + '_%d';

	var memc = new Memcached('localhost:11211', {poolSize: 1000});
	memc.add(start_key, 0);
	memc.add(end_key, 0);

	var _unlock = function(cb) {
		memc.del(lock_key, cb);
	};

	var _lock = function(cb) {
		// standard spin lock - expire in 2 seconds
		memc.add(lock_key, '1', 2, cb);
	};

	this.push = function(elem, cb) {
		_lock(function() {
				memc.incr(end_key, i, function(err, i) {
						memc.set(util.format(item_key_format, i), $elem, function() {
								_unlock(cb(elem));
							});
					});
			});
	};

	this.pop = function(cb) {
		_lock(function() {
				memc.incr(start_key, function(err, i) {
						memc.get(util.format(item_key_format, i), function(err, elem) {
								var unlock_cb = function() {
									cb(elem);
								}
								if (false === elem) { // eoq
									memc.incr(end_key, unlock_cb);
								} else {
									unlock_cb();
								}
							});
					});
			});
	};

	this.peek = function() {
		memc.get(start_key, function(err, i) {
				memc.get(util.format(item_key_format, i+1), cb);
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
				memc.get(this.start_key, function(err, start) {
						memc.get(this.end_key, function(err, end) {
								var memc_delete = function(key, i) {
									if (i < end) {
										memc.del(util.format(this.item_key_format, i+1), function() {
												memc_delete(i+1);
											});
									} else {
										memc.set(start_key, end, function() {
												_unlock(cb);
											});
									}
								}
								memc_delete(start);
							});
					});
			});
	};

	this.end = function(cb) {
		memc.end();
		if (cb) {
			cb();
		}
	}

};

// unit tests
var q = new memq('testq');
q.count(function(count) {
		assert.equal(count, 0);
		q.is_empty(function(ret) {
				assert.equal(ret, true);
				q.push('a');
				q.push('b');
				q.push('c');
				q.end();
			});

	});

