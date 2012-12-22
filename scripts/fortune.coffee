# Description:
#   Get a fortune
#
# Dependencies:
#   None
#
# Configuration:
#   None
#
# Commands:
#   hubot fortune me - Displays a super true fortune
#
# Author:
#   mrtazz

get_fortune = (robot, onSuccess, onError) ->
  robot.http('http://www.fortunefortoday.com/getfortuneonly.php')
     .get() (err, res, body) ->
        if err then onError(err, res) else onSuccess(body, res)

init_checker = (robot) ->
  checker = setInterval ->
    get_fortune robot, (body) ->
      robot.messageRoom('##scopyleft', body)
    , (err) ->
      console.error err
  , 1000 * 60 * 60 # 1 hour

module.exports = (robot) ->
  robot.respond /(fortune)( me)?/i, (msg) ->
    get_fortune robot, (body) ->
      msg.reply body
    , (err) ->
      console.error err

  init_checker(robot)
