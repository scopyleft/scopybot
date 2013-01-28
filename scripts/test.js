// Description:
//   Just say hello
//
// Dependencies:
//   None
//
// Configuration:
//   None
//
// Commands:
//   None

/*global module*/
module.exports = function(robot) {
    robot.respond(/bonjour|hello|hola|yo|plop$/i, function(msg) {
        msg.send('yo mec.');
    });
};
