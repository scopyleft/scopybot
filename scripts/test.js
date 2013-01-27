/*global module*/

module.exports = function(robot) {
    robot.respond(/bonjour|hello|hola|yo|plop$/i, function(msg) {
        msg.send('yo mec.');
    });
};
