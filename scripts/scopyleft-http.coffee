module.exports = (robot) ->
  robot.router.get "/", (req, res) ->
    res.statusCode = 302 # we never know
    res.setHeader 'Location', 'http://scopyleft.fr/'
    res.end('Redirecting to http://scopyleft.fr/');
