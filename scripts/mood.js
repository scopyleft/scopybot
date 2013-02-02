// Description:
//   Records moods over time.
//
// Dependencies:
//   redis
//
// Configuration:
//   HUBOT_MOOD_REDIS_URL: url to redis storage backend
//
// Commands:
//   mood set "<sunny|cloudy|rainy|stormy>"
//   mood of <(nickname)|me>
//   mood today
//   mood yesterday
//   mood week of <(nickname)|me>
//   mood month of <(nickname)|me>
//
// Author:
//   n1k0

/*global module process*/
var bot
  , util   = require('util')
  , events = require('events')
  , format = util.format
  , Url    = require("url")
  , Redis  = require("redis");


function datetime(date) {
    if (typeof date === "string") {
        try {
            date = new Date(date);
        } catch (e) {
            return date;
        }
    }
    return date.toISOString().split('T')[0];
}

function daysBefore(days, from) {
    from = from || new Date();
    return new Date(from - (86400 * 1000 * days));
}

function today() {
    return datetime(new Date());
}

function yesterday() {
    return datetime(daysBefore(1));
}

function MoodEngine(client, options) {
    events.EventEmitter.call(this);
    this.client     = client;
    this.validMoods = "sunny|cloudy|rainy|stormy".split('|');
    this.bars       = "▇▅▃▁".split('');
    this.redisKey   = options && options.redisKey || "moods";
}
util.inherits(MoodEngine, events.EventEmitter);

MoodEngine.prototype.filter = function filter(moods, filters) {
    if (!moods.length || !filters) {
        return [];
    }
    return moods.filter(function(mood) {
        var included = true;
        if (filters.date) {
            included = included && datetime(mood.date) === datetime(filters.date);
        }
        if (~~filters.since > 0) {
            included = included && datetime(mood.date) >= datetime(daysBefore(~~filters.since));
        }
        if (filters.user) {
            included = included && mood.user === filters.user;
        }
        return included;
    });
};

MoodEngine.prototype.query = function query() {
    var self = this, filters = {}, cb;
    if (arguments.length === 2 && typeof arguments[1] === "function") {
        filters = typeof arguments[0] === "object" ? arguments[0] : {};
        cb = arguments[1];
    } else {
        cb = arguments[0];
    }
    this.client.lrange(this.redisKey, 0, -1, function(err, reply) {
        var moods = [];
        if (err) return cb.call(self, err);
        try {
            moods = reply.map(function(entry) {
                var parts = entry.split(':');
                return {
                    date: parts[0]
                  , user: parts[1]
                  , mood: parts[2]
                };
            });
        } catch (e) {
            err = e;
        }
        return cb.call(self, err, self.filter(moods, filters));
    });
};

MoodEngine.prototype.exists = function exists(filters, cb) {
    this.query(filters, function(err, moods) {
        if (err) return cb.call(this, err);
        return cb.call(this, err, moods.length > 0);
    });
};

MoodEngine.prototype.graph = function graph(filters, cb) {
    var self = this;
    if (!filters.user) return cb.call(this, new Error("a user is mandatory"));
    if (!filters.since) return cb.call(this, new Error("a since filter is mandatory"));
    this.query(filters, function(err, moods) {
        var graph = "";
        if (!moods || !moods.length) {
            return cb.call(this, new Error(format('No mood entry for %s in the last %d days.',
                                                  filters.user, filters.since)));
        }
        return cb.call(this, null, moods.map(function(mood) {
            return self.bars[self.validMoods.indexOf(mood.mood)];
        }).join(''));
    });
};

MoodEngine.prototype.store = function store(data, cb) {
    var self = this
      , date   = today()
      , entry  = format('%s:%s:%s', date, data.user, data.mood);
    if (this.validMoods.indexOf(data.mood) === -1) {
        return cb.call(this, new Error(format('Invalid mood %s; valid values are %s',
                                              data.mood, this.validMoods.join(', '))));
    }
    console.log('plop');
    this.exists({ date: date, user: data.user }, function(err, exists) {
        if (err) return cb.call(self, err);
        if (exists) {
            return cb.call(self, new Error(format('Mood already stored for %s on %s', data.user, date)));
        }
        self.emit('info', format('storing mood entry for %s: %s', data.user, entry));
        self.client.rpush(self.redisKey, entry, function(err) {
            cb.call(self, err);
        });
    });
};

module.exports = function(robot) {
    bot = robot;

    var info   = Url.parse(process.env.HUBOT_MOOD_REDIS_URL || 'redis://localhost:6379')
      , client = Redis.createClient(info.port, info.hostname)
      , engine = new MoodEngine(client);

    if (info.auth) {
        client.auth(info.auth.split(":")[1]);
    }

    client.on("error", function(err) {
        robot.logger.error(err);
    });

    client.on("connect", function() {
        robot.logger.debug("Successfully connected to Redis from mood script");
    });

    engine.on('info', function(msg) {
        robot.logger.info(msg);
    });

    robot.respond(/mood set (\w+)$/i, function(msg) {
        var user = msg.message.user && msg.message.user.name || "anon"
         ,  mood = msg.match[1].toLowerCase();
        engine.store({ user: user, mood: mood }, function(err, reply) {
            if (err) return msg.send(err);
            msg.send(format('Recorded entry: %s is in a %s mood today', user, mood));
        });
    });

    robot.respond(/mood today$/i, function(msg) {
        msg.send(format("Today's moods:"));
        engine.query({ date: today() }, function(err, moods) {
            if (err) return msg.send(err);
            if (!moods || !moods.length) return msg.send('No mood entry for today.');
            moods.forEach(function(mood) {
                msg.send(format('- %s is in a %s mood', mood.user, mood.mood));
            });
        });
    });

    robot.respond(/mood yesterday$/i, function(msg) {
        msg.send(format("Yesterday's moods:"));
        engine.query({ date: yesterday() }, function(err, moods) {
            if (err) return msg.send(err);
            if (!moods || !moods.length) return msg.send('No mood entry for yesterday.');
            moods.forEach(function(mood) {
                msg.send(format('- %s was in a %s mood', mood.user, mood.mood));
            });
        });
    });

    robot.respond(/mood month (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        engine.graph({ user: user, since: 30 }, function(err, graph) {
            if (err) return msg.send(err);
            msg.send(graph);
        });
    });

    robot.respond(/mood week (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        engine.graph({ user: user, since: 7 }, function(err, graph) {
            if (err) return msg.send(err);
            msg.send(graph);
        });
    });

    robot.respond(/mood (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        engine.query({date: today(), user: user}, function(err, moods) {
            if (err) return msg.send(err);
            if (!moods || !moods[0]) {
                return msg.send(format('%s has not set a mood, yet', user));
            }
            msg.send(format('%s: %s is in a %s mood', moods[0].date, moods[0].user, moods[0].mood));
        });
    });
};
