/*global require,module*/

const fs = require("fs");
const util = require("util");

module.exports = {
    log: function(...args) {
        const str = util.format(...args);
        fs.appendFileSync("/tmp/na-server.log", str + "\n");
    },
    error: function(...args) {
        const str = util.format(...args);
        fs.appendFileSync("/tmp/na-server.log", str + "\n");
    }
};
