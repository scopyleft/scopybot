// Description:
//   Records moods over time.
//
// Dependencies:
//   redis
//
// Configuration:
//   None
//
// Commands:
//   mood set "<sunny|cloudy|rainy|stormy>"
//   mood of <(nickname)|me>
//   mood today
//   mood yesterday

/*global module process*/
var bot
  , util       = require('util')
  , format     = util.format
  , validMoods = "sunny|cloudy|rainy|stormy".split('|')
  , bars       = "▇▅▃▂".split('')
  , redisKey   = "moods"
  , Url        = require("url")
  , Redis      = require("redis");


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

function filterMoods(moods, filters) {
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
}

function getMoods() {
    var filters = {}, cb;
    if (arguments.length === 2 && typeof arguments[1] === "function") {
        filters = typeof arguments[0] === "object" ? arguments[0] : {};
        cb = arguments[1];
    } else {
        cb = arguments[0];
    }
    this.lrange(redisKey, 0, -1, function(err, reply) {
        var moods = [];
        if (err) return cb(err);
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
        return cb(err, filterMoods(moods, filters));
    });
}

function moodExists(filters, cb) {
    getMoods.call(this, filters, function(err, moods) {
        return cb(err, moods.length > 0);
    });
}

function moodGraph(filters, cb) {
    if (!filters.user) return cb(new Error("a user is mandatory"));
    if (!filters.since) return cb(new Error("a since filter is mandatory"));
    getMoods.call(this, filters, function(err, moods) {
        var graph = "";
        if (!moods || !moods.length) {
            return cb(new Error(format('No mood entry for %s in the last %d days.', filters.user, filters.since)));
        }
        return cb(null, moods.map(function(mood) {
            return bars[validMoods.indexOf(mood.mood)];
        }).join(''));
    });
}

function storeMood(user, mood, cb) {
    var client = this,
        date   = today()
      , entry  = format('%s:%s:%s', date, user, mood);
    if (validMoods.indexOf(mood) === -1) {
        return cb(new Error(format('Invalid mood %s; valid values are %s',
                                   mood, validMoods.join(', '))));
    }
    moodExists.call(client, { date: date, user: user }, function(err, exists) {
        if (err) throw err;
        if (exists) {
            return cb(new Error(format('Mood already stored for %s on %s', user, date)));
        }
        bot.logger.info(format('storing mood entry for %s: %s', user, entry));
        client.rpush(redisKey, entry, cb);
    });
}

module.exports = function(robot) {
    bot = robot;

    var info   = Url.parse(process.env.REDISTOGO_URL) || 'redis://localhost:6379'
      , client = Redis.createClient(info.port, info.hostname);

    if (info.auth) {
        client.auth(info.auth.split(":")[1]);
    }

    client.on("error", function(err) {
        robot.logger.error(err);
    });

    client.on("connect", function() {
        robot.logger.debug("Successfully connected to Redis from mood script");
    });

    robot.respond(/mood set (\w+)$/i, function(msg) {
        var user = msg.message.user && msg.message.user.name || "anon"
         ,  mood = msg.match[1].toLowerCase();
        storeMood.call(client, user, mood, function(err, reply) {
            if (err) return msg.send(err);
            msg.send(format('Recorded entry: %s is in a %s mood today', user, mood));
        });
    });

    robot.respond(/mood today$/i, function(msg) {
        msg.send(format("Today's moods:"));
        getMoods.call(client, { date: today() }, function(err, moods) {
            if (err) return msg.send(err);
            if (!moods || !moods.length) return msg.send('No mood entry for today.');
            moods.forEach(function(mood) {
                msg.send(format('- %s is in a %s mood', mood.user, mood.mood));
            });
        });
    });

    robot.respond(/mood yesterday$/i, function(msg) {
        msg.send(format("Yesterday's moods:"));
        getMoods.call(client, { date: yesterday() }, function(err, moods) {
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
        moodGraph.call(client, { user: user, since: 30 }, function(err, graph) {
            if (err) return msg.send(err);
            msg.send(graph);
        });
    });

    robot.respond(/mood week (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        moodGraph.call(client, { user: user, since: 7 }, function(err, graph) {
            if (err) return msg.send(err);
            msg.send(graph);
        });
    });

    robot.respond(/mood (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        getMoods.call(client, {date: today(), user: user}, function(err, moods) {
            if (err) return msg.send(err);
            if (!moods || !moods[0]) {
                return msg.send(format('%s has not set a mood, yet', user));
            }
            msg.send(format('%s: %s is in a %s mood', moods[0].date, moods[0].user, moods[0].mood));
        });
    });
};
