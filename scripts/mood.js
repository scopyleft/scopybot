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
  , format     = require('util').format
  , validMoods = "sunny|cloudy|rainy|stormy".split('|')
  , bars       = "▇▅▃▂".split('')
  , redisKey   = "moods"
  , Url        = require("url")
  , Redis      = require("redis");


function datetime(date) {
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

function getMoods(cb) {
    this.lrange(redisKey, 0, -1, function(err, reply) {
        var moods;
        if (err) cb(err);
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
        cb(err, moods || []);
    });
}

function moodExists(date, user, cb) {
    getMoods.call(this, function(err, moods) {
        cb(err, moods.some(function(mood) {
            return mood.date === today() && mood.user === user;
        }));
    });
}

function storeMood(user, mood, cb) {
    var client = this,
        date   = today()
      , entry  = format('%s:%s:%s', date, user, mood);
    moodExists.call(client, date, user, function(err, exists) {
        if (err) throw err;
        if (exists) {
            return bot.send(format('mood already stored for %s on %s', user, date));
        }
        bot.logger.info('storing mood entry: ' + entry);
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
        if (validMoods.indexOf(mood) === -1) {
            return msg.send(format('Invalid mood %s; valid values are %s',
                                   mood, validMoods.join(', ')));
        }
        storeMood.call(client, user, mood, function(err, reply) {
            if (err) throw err;
            msg.send(format('Recorded entry: %s is in a %s mood today', user, mood));
        });
    });

    robot.respond(/mood today$/i, function(msg) {
        msg.send(format("Today's moods:"));
        getMoods.call(client, function(err, moods) {
            var todayMoods = moods.filter(function(mood) {
                return mood.date === today();
            });
            if (!todayMoods || !todayMoods.length) {
                return msg.send('No mood entry for today.');
            }
            todayMoods.forEach(function(mood) {
                msg.send(format('- %s is in a %s mood', mood.user, mood.mood));
            });
        });
    });

    robot.respond(/mood yesterday$/i, function(msg) {
        msg.send(format("Yesterday's moods:"));
        getMoods.call(client, function(err, moods) {
            var yesterdayMoods = moods.filter(function(mood) {
                return mood.date === yesterday();
            });
            if (!yesterdayMoods || !yesterdayMoods.length) {
                return msg.send('No mood entry for yesterday.');
            }
            yesterdayMoods.forEach(function(mood) {
                msg.send(format('- %s was in a %s mood', mood.user, mood.mood));
            });
        });
    });

    robot.respond(/mood week (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        getMoods.call(client, function(err, moods) {
            var graph = ""
              , weekMoods = moods.filter(function(mood) {
                return mood.user === user && new Date(mood.date) >= daysBefore(7);
            });
            if (!weekMoods || !weekMoods.length) {
                return msg.send(format('No mood entry for %s in the last 7 days.', user));
            }
            msg.send(weekMoods.map(function(mood) {
                return bars[validMoods.indexOf(mood.mood)];
            }).join(''));
        });
    });

    robot.respond(/mood (of|for) (.*)$/i, function(msg) {
        var user = msg.match[2];
        if (user.toLowerCase().trim() === "me") {
            user = msg.message.user && msg.message.user.name;
        }
        getMoods.call(client, function(err, moods) {
            var userMood = moods.filter(function(mood) {
                return mood.date === today() && mood.user === user;
            })[0];
            if (!userMood) {
                return msg.send(format('%s has not set a mood, yet', user));
            }
            msg.send(format('%s is in a %s mood', userMood.user, userMood.mood));
        });
    });
};
