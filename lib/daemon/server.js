/*global require,process*/

"use strict";

const ipc = require("@jhanssen/ipc");
const daemonize = require("daemon");
const homedir = require("homedir");
const path = require("path");
const fs = require("fs");
const util = require("util");
const appRoot = require("app-root-path");
const player = require(appRoot + "/lib/daemon/player");
const console = require(appRoot + "/lib/daemon/console");

function handle(id, data)
{
    if ("exit" in data.argv) {
        // we're done
        process.exit();
    }
    player.handle(data).then(ret => {
        console.log("handled", ret, id, typeof id);
        try {
            let send = JSON.stringify(ret || "ok.");
            ipc.write(send, [id]);
        } catch (e) {
            ipc.write("error " + e, [id]);
        }
    }).catch(e => {
        ipc.write("error " + e.stack, [id]);
    });
}

function server() {
    player.setup();

    process.on("uncaughtException", err => {
        console.error("uncaught exception " + err);
    });
    const p = path.join(homedir(), ".na.socket");
    // false means don't stop on last client disconnect
    if (!ipc.listen(p, false)) {
        process.exit();
    }
    // ipc.on("newClient", id => {
    //     state.clients.add(id);
    // });
    // ipc.on("disconnectedClient", (id) => {
    //     state.clients.delete(id);
    // });
    // ipc.on("disconnected", () => {
    //     process.exit();
    // });
    ipc.on("data", (id, datastr) => {
        console.log("got data", datastr);
        try {
            let data = JSON.parse(datastr);
            handle(id, data);
        } catch (e) {
            console.log("didn't parse as json", e);
        }
    });
}

try {
    const argv = require("minimist")(process.argv.slice(2));

    if (argv.daemon !== false) {
        daemonize({ cwd: process.cwd() });
        if (!argv.verbose)
            console.setQuiet(true);
    } else {
        console.setDaemon(false);
    }

    server();
} catch (e) {
    console.error(e + "");
}
