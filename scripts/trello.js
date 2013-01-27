/*global module process*/
var util   = require('util')
  , format = util.format
  , moment = require('moment')
  , Trello = require('node-trello')
  , scopybot
  , checkIntervalMs = process.env.HUBOT_TRELLO_INTERVAL || 1000 * 60 * 5
  , lastNotifId
  , config = {
        key:         process.env.HUBOT_TRELLO_KEY
      , token:       process.env.HUBOT_TRELLO_TOKEN
      , archiveDays: process.env.HUBOT_TRELLO_ARCHIVE_DAYS || 15
      , notifyRoom:  process.env.HUBOT_TRELLO_NOTIFY_ROOM
    }
  , filterActions = {
    changeCard: function(notif) {
        if (!('listAfter' in notif.data)) return;
        return format("%s moved card `%s` from `%s` to `%s` - %s",
                      notif.memberCreator.username,
                      notif.data.card.name,
                      notif.data.listBefore.name,
                      notif.data.listAfter.name,
                      notif.data.card.shortUrl);
    },
    commentCard: function(notif) {
        return format("%s commented on card `%s`: %s - %s",
                      notif.memberCreator.username,
                      notif.data.card.name,
                      notif.data.text,
                      notif.data.card.shortUrl);
    },
    createdCard: function(notif) {
        return format("%s created card `%s` - %s",
                      notif.memberCreator.username,
                      notif.data.card.name,
                      notif.data.card.shortUrl);
    }
};

function defaultErrorHandler(error) {
    console.error(error);
    if (scopybot) {
        scopybot.messageRoom(config.notifyRoom, "ERROR: " + error)
    }
}

function handleError(error, onError) {
    console.error(error);
    if (typeof onError === "function") {
        return onError(error);
    }
    defaultErrorHandler(error);
}

function connect(onConnected, onError) {
    var t;
    if (!config.key) console.error("missing HUBOT_TRELLO_KEY");
    if (!config.token) console.error("missing HUBOT_TRELLO_TOKEN");
    if (!config.notifyRoom) console.error("missing HUBOT_TRELLO_NOTIFY_ROOM");
    try {
        t = new Trello(config.key, config.token);
    } catch (err) {
        return handleError(err, onError);
    }
    if (typeof onConnected === "function") onConnected(t);
}

function dump(data) {
    return console.log(JSON.stringify(data, null, 4));
}

function getBoards(cb, onError) {
    connect(function(t) {
        t.get("/1/organizations/scopyleft/boards", {
            lists: 'open',
            filter: 'pinned'
        }, function(err, boards) {
            if (err) return handleError(err, onError);
            cb(err, boards);
        });
    });
}

function getNotifs(query, onComplete, onError) {
    connect(function(t) {
        t.get("/1/members/me/notifications", query, function(err, notifications) {
            if (err) return handleError(err, onError);
            try {
                lastNotifId = notifications[0].id;
            } catch (e) {}
            onComplete(notifications.map(function(notification) {
                return filterActions[notification.type](notification);
            }).filter(function(notification) {
                return notification !== undefined;
            }));
        });
    }, onError);
}

function initCheckers(robot) {
    var archiveChecker, overflowChecker;
    overflowChecker = setInterval(function() {
        checkOverflow(function(messages) {
            messages.forEach(function(message) {
                robot.messageRoom(config.notifyRoom, message)
            });
        });
    }, checkIntervalMs);
    archiveChecker = setInterval(function() {
        checkArchive(function(messages) {
            messages.forEach(function(message) {
                robot.messageRoom(config.notifyRoom, message)
            });
        });
    }, checkIntervalMs);
}

function parseMaxCards(list) {
    var match, maxCards = 0;
    match = /\((\d+)\)$/.exec(list.name);
    if (match) {
        maxCards = parseInt(match[1], 10);
    }
    return maxCards;
}

function boardInfo(board, sep) {
    sep = sep || "\n -> ";
    return format("Board: %s:%s%s", board.name, sep, board.lists.map(function(list) {
        return list.name;
    }).join(sep));
}

function archiveCard(card, cb, onError) {
    connect(function(t) {
        t.put(format("/1/cards/%s/closed", card.id), { value: "true" }, function(err) {
            if (err) return handleError(err, onError);
            t.post(format("/1/cards/%s/actions/comments", card.id), {
                text: format("This card has not been updated since %d days, archived.",
                             config.archiveDays)
            }, function(err) {
                if (err) return handleError(err, onError);
                cb(card);
            })
        });
    }, onError);
}

function archiveListsCards(lists, board, onError) {
    var messages = [];
    var filteredLists = lists.filter(function(list) {
        return list.name === 'Terminé';
    });
    filteredLists.forEach(function(list) {
        list.cards.filter(function(card) {
            return !(/^Lisez-moi/.test(card.name)) && !card.closed;
        }).forEach(function(card) {
            if (moment(card.dateLastActivity).add('days', config.archiveDays) >= moment()) return;
            archiveCard(card, function(card) {
                console.info("archived " + card.name);
            }, onError);
            messages.push(format("card %s > %s > %s is more than %d days old, archived %s",
                                 board.name,
                                 list.name,
                                 card.name,
                                 config.archiveDays,
                                 card.shortUrl));
        });
    });
    return messages.filter(function(message) {
        return message !== undefined;
    });
}

function checkArchive(cb, onError) {
    return getBoards(function(err, boards) {
        if (err) return handleError(err, onError);
        boards.forEach(function(board) {
            connect(function(t) {
                t.get(format("/1/boards/%s/lists", board.id), {
                    cards: 'open'
                }, function(err, lists) {
                    if (err) return handleError(err, onError);
                    return cb(archiveListsCards(lists, board, onError));
                });
            }, onError);
        });
    });
}

function checkOverflow(cb, onError) {
    getBoards(function(err, boards) {
        if (err) return handleError(err, onError);
        boards.forEach(function(board) {
            connect(function(t) {
                t.get(format("/1/boards/%s/lists", board.id), { cards: 'open' }, function(err, lists) {
                    if (err) return handleError(err, onError);
                    cb(lists.map(function(list) {
                        var maxCards = parseMaxCards(list);
                        if (!maxCards) return;
                        if (list.cards.length <= maxCards) return;
                        return format("task overflow detected in %s > %s: %d/%d https://trello.com/board/%s",
                                      board.name,
                                      list.name,
                                      list.cards.length,
                                      maxCards,
                                      board.id);
                    }).filter(function(message) {
                        return message !== undefined;
                    }));
                });
            }, onError);
        });
    });
}

module.exports = function(robot) {
    scopybot = robot;

    robot.respond(/trello boards$/i, function(msg) {
        connect(function(t) {
            t.get("/1/organizations/scopyleft/boards", {
                lists: 'open'
            }, function(err, boards) {
                if (err) return handleError(err);
                boards.forEach(function(board) {
                    msg.send(boardInfo(board));
                });
            });
        });
    });

    robot.respond(/trello check overflow$/i, function(msg) {
        checkOverflow(function(messages) {
            messages.forEach(function(message) {
                msg.send(message);
            });
        });
    });

    robot.respond(/trello check archive$/i, function(msg) {
        checkArchive(function(messages) {
            messages.forEach(function(message) {
                msg.send(message);
            });
        });
    });

    robot.respond(/trello ping$/i, function(msg) {
        connect(function(t) {
            msg.send("trello PONG");
        });
    });

    robot.respond(/trello recent$/i, function(msg) {
        var query = {
            filter: Object.keys(filterActions),
            read_filter: 'unread',
            limit: 10,
            since: lastNotifId
        };
        getNotifs(query, function(notifs) {
            notifs.forEach(function(notif) {
                msg.send(notif);
            });
        });
    });

    initCheckers(robot);
};
