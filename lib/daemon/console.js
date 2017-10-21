/*global require,module*/

const fs = require("fs");
const util = require("util");

module.exports = {
    _daemon: true,
    _quiet: false,

    log: function(...args) {
        if (this._quiet)
            return;
        if (this._daemon) {
            const str = util.format(...args);
            fs.appendFileSync("/tmp/na-server.log", str + "\n");
        } else {
            console.log.call(console, ...args);
        }
    },
    error: function(...args) {
        if (this._quiet)
            return;
        if (this._daemon) {
            const str = util.format(...args);
            fs.appendFileSync("/tmp/na-server.log", str + "\n");
        } else {
            console.error.call(console, ...args);
        }
    },
    setDaemon(daemon) { this._daemon = daemon; },
    setQuiet(quiet) { this._quiet = quiet; }
};
