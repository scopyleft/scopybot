# Description:
#   Get notifications from trello
#
# Dependencies:
#   "node-trello": "0.1.2"
#
# Configuration:
#   HUBOT_TRELLO_KEY - trello developer key
#   HUBOT_TRELLO_TOKEN - trello developer app token
#   HUBOT_TRELLO_BOARD_ID - trello board id
#
# Commands:
#   hubot trello check - check notifications
#   hubot trello ping - check connection
#
# Notes:
#   Currently cards can only be added to your default list/board although
#   this can be changed
#
#   Get app token by heading to https://trello.com/1/connect?
#       key=#{HUBOT_TRELLO_KEY}&name=#{HUBOT_TRELLO_APPNAME}&
#       response_type=token&scope=read,write&expiration=never
#
# Author:
#   n1k0

Trello = require 'node-trello'

check_interval_ms = process.env.HUBOT_TRELLO_INTERVAL ? 1000 * 60 * 5
checker = undefined
trello_key = process.env.HUBOT_TRELLO_KEY
trello_token = process.env.HUBOT_TRELLO_TOKEN
trello_board_id = process.env.HUBOT_TRELLO_BOARD_ID

last_notif_id = undefined

filter_actions =
  changeCard: (notif) ->
    if 'listAfter' not of notif.data
      return
    "#{notif.memberCreator.username} moved card `#{notif.data.card.name}` from `#{notif.data.listBefore.name}` to `#{notif.data.listAfter.name}` - #{cardUrl(notif.data.card)}"
  commentCard: (notif) ->
    "#{notif.memberCreator.username} commented on card `#{notif.data.card.name}`: #{notif.data.text} - #{cardUrl(notif.data.card)}"
  createdCard: (notif) ->
    "#{notif.memberCreator.username} created card `#{notif.data.card.name}` - #{cardUrl(notif.data.card)}"

cardUrl = (card) ->
  "https://trello.com/card/#{trello_board_id}/#{card.idShort}"

connect = (onConnected, onError) ->
  console.error "missing HUBOT_TRELLO_KEY" if not trello_key
  console.error "missing HUBOT_TRELLO_TOKEN" if not trello_token
  console.error "missing HUBOT_TRELLO_BOARD_ID" if not trello_board_id
  try
    t = new Trello trello_key, trello_token
  catch e
    console.error e
    return onError?(e)
  onConnected?(t)

dump = (data) ->
  console.log(JSON.stringify(data, null, 4))

get_notifs = (options, onComplete, onError) ->
  connect (t) ->
    console.info('retrieving notifications...')
    t.get "/1/members/me/notifications", options, (err, data) ->
      if data.length
        console.info('set last_notif_id=' + data[0].id)
        last_notif_id = data[0].id
      raw_notifs = (filter_actions[notif.type](notif) for notif in data)
      onComplete(notif for notif in raw_notifs when notif isnt undefined)
  , onError

init_checker = (robot) ->
  console.info "set interval check to #{check_interval_ms}"
  checker = setInterval ->
    console.info "checking for new notifications..."
    options =
      filter: Object.keys(filter_actions)
      read_filter: 'unread'
      limit: 10
      since: last_notif_id
    get_notifs options, (notifs) ->
      console.info "#{notifs.length} new notifications received"
      for notif in notifs
        robot.messageRoom("", notif)
    , (err) ->
      msg.send "Error: #{err}"
  , check_interval_ms

module.exports = (robot) ->
  robot.respond /trello ping/i, (msg) ->
    connect (t) -> msg.send "trello PONG", (err) -> console.log err

  robot.respond /trello recent$/i, (msg) ->
    options =
      filter: Object.keys(filter_actions)
      read_filter: 'unread'
      limit: 10
      since: last_notif_id
    get_notifs options, (notifs) ->
      for notif in notifs
        msg.send(notif)
    , (err) ->
      msg.send "Error: #{err}"

  init_checker(robot)
