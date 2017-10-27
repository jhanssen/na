/*global require,module,setInterval,clearInterval*/

"use strict";

const ipc = require("@jhanssen/ipc");
const homedir = require("homedir");
const path = require("path");
const supportsColor = require("supports-color");
const childProcess = require("child_process");
const appRoot = require("app-root-path");

const daemon = {
    _path: path.join(homedir(), ".na.socket"),
    _resolve: undefined,
    _reject: undefined,
    _timeout: 5000,

    run: function(argv) {
        if (ipc.connect(this._path)) {
            // we're already running as a server
            console.error("server already running");
            return;
        }
        require(appRoot + "/lib/daemon/server");
    },

    send: function(cwd, argv) {
        return new Promise((resolve, reject) => {
            if (ipc.connect(this._path)) {
                this._setup(resolve, reject);
                this._write({ cwd: cwd, argv: argv });
            } else {
                if (!this._launch(argv)) {
                    reject("couldn't launch ipc daemon");
                    return;
                }
                let start = Date.now();
                let iv = setInterval(() => {
                    // console.log("ipc connect trying");
                    if (Date.now() - start > this._timeout) {
                        // console.log("ipc connect timeout");
                        clearInterval(iv);
                        reject("timeout");
                        return;
                    }
                    if (ipc.connect(this._path)) {
                        // console.log("ipc connected 2");
                        clearInterval(iv);
                        this._setup(resolve, reject);
                        this._write({ cwd: cwd, argv: argv });
                    }
                }, 500);
            }
        });
    },

    _setup: function(resolve, reject) {
        this._resolve = resolve;
        this._reject = reject;
        ipc.on("disconnected", () => {
            this._reject("disconnected");
        });
        ipc.on("data", (id, datastr) => {
            try {
                let data = JSON.parse(datastr);
                this._resolve(data);
            } catch (e) {
                console.error(`invalid json '${datastr}'`);
                this._reject(e);
            }
        });
    },

    _write: function(data) {
        if (typeof data == "string") {
            ipc.write(data);
        } else {
            let d;
            try {
                d = JSON.stringify(data);
                ipc.write(d);
            } catch (e) {
                this._reject(e);
            }
        }
    },

    _launch: function(argv) {
        const args = [];
        if (supportsColor.stdout) {
            switch (supportsColor.stdout.level) {
            case 1:
                args.push("--color");
                break;
            case 2:
                args.push("--color=256");
                break;
            case 3:
                args.push("--color=16m");
                break;
            }
        }
        if (argv.verbose) {
            args.push("--verbose");
        }
        childProcess.fork(appRoot + "/lib/daemon/server", args);
        return true;
    }
};

module.exports = daemon;
