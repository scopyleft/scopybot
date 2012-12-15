# Description:
#   Get notifications from trello
#
# Dependencies:
#   "node-trello": "0.1.2"
#
# Configuration:
#   HUBOT_TRELLO_KEY - trello developer key
#   HUBOT_TRELLO_TOKEN - trello developer app token
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
trello_key = process.env.HUBOT_TRELLO_KEY
trello_token = process.env.HUBOT_TRELLO_TOKEN
trello_board_id = process.env.HUBOT_TRELLO_BOARD_ID
filter_actions =
  changeCard: (notif) ->
    if 'listAfter' of notif.data
      "#{notif.memberCreator.username} moved card `#{notif.data.card.name}` from `#{notif.data.listBefore.name}` to `#{notif.data.listAfter.name}`" + cardUrl(notif.data.card)
    else
      "#{notif.memberCreator.username} updated card `#{notif.data.card.name}`" + cardUrl(notif.data.card)
  commentCard: (notif) ->
    "#{notif.memberCreator.username} commented on card `#{notif.data.card.name}`: #{notif.data.text}" + cardUrl(notif.data.card)
  createdCard: (notif) ->
    "#{notif.memberCreator.username} created card `#{notif.data.card.name}`" + cardUrl(notif.data.card)

cardUrl = (card) ->
  " - https://trello.com/card/#{trello_board_id}/#{card.idShort}"

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

module.exports = (robot) ->
  robot.respond /trello ping/i, (msg) ->
    connect (t) -> msg.send "trello PONG", (err) -> console.log err

  robot.respond /trello recent$/i, (msg) ->
    options =
      filter: Object.keys(filter_actions)
      read_filter: 'unread'
      limit: 10
    connect (t) ->
      t.get "/1/members/me/notifications", options, (err, data) ->
        msg.send filter_actions[notif.type](notif) for notif in data
    , (err) ->
      msg.send "Error: #{err}"
