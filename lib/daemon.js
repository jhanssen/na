/*global require,module,setInterval,clearInterval*/

const ipc = require("@jhanssen/ipc");
const homedir = require("homedir");
const path = require("path");
const childProcess = require("child_process");

const daemon = {
    _path: undefined,
    _resolve: undefined,
    _reject: undefined,
    _timeout: 5000,

    send: function(cwd, argv) {
        this._path = path.join(homedir(), ".na.socket");
        return new Promise((resolve, reject) => {
            if (ipc.connect(this._path)) {
                this._setup(resolve, reject);
                this._write({ cwd: cwd, argv: argv });
            } else {
                if (!this._launch()) {
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

    _launch: function() {
        childProcess.fork("./lib/server");
        return true;
    }
};

module.exports = daemon;
