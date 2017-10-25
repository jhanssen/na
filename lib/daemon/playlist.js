/*global require,module,process,setTimeout,clearTimeout*/

"use strict";

const fs = require("fs");
const path = require("path");
const homedir = require("homedir");
const appRoot = require("app-root-path");
const EventEmitter = require("events");

const console = require(appRoot + "/lib/daemon/console");

class Playlist extends EventEmitter
{
    constructor(exts) {
        super();

        this.metadata = new Map();
        this.playlist = [];
        this.index = 0;
        this.exts = new Set();
        for (let i = 0; i < exts.length; ++i) {
            this.exts.add(exts[i]);
        }
    }

    add(item) {
        this.playlist.push(item);
    }

    remove(start, num) {
        if (typeof start === "number") {
            // by index
            if (typeof num !== "number") {
                // bad
                return false;
            }
            if (start < 0 || start + num >= this.playlist.length)
                return false;
            this.playlist.splice(start, num);
            return true;
        } else {
            // by item
            const idx = this.playlist.indexOf(start);
            if (idx !== -1) {
                this.playlist.splice(idx, 1);
                return true;
            }
            return false;
        }
    }

    clear() {
        this.playlist = [];
        this.index = 0;
    }

    save(cwd, p) {
        return new Promise((resolve, reject) => {
            let p;
            if (!p || (p instanceof Array && !p.length)) {
                // default path
                p = path.join(homedir(), ".na-playlist.lst");
            } else {
                if (p instanceof Array && p.length > 0) {
                    if (!p[0].length) {
                        p = path.join(homedir(), ".na-playlist.lst");
                    } if (p[0] === '/') {
                        p = p[0];
                    } else {
                        p = path.join(cwd, p[0]);
                    }
                }
            }
            if (p) {
                fs.writeFile(p, JSON.stringify(this.playlist, null, 2), err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                reject("No path");
            }
        });
    }

    load(cwd, p) {
        return new Promise((resolve, reject) => {
            let p;
            if (!p || (p instanceof Array && !p.length)) {
                // default path
                p = path.join(homedir(), ".na-playlist.lst");
            } else {
                if (p instanceof Array && p.length > 0) {
                    if (!p[0].length) {
                        p = path.join(homedir(), ".na-playlist.lst");
                    } if (p[0] === '/') {
                        p = p[0];
                    } else {
                        p = path.join(cwd, p[0]);
                    }
                }
            }
            if (p) {
                fs.readFile(p, "utf8", (err, data) => {
                    if (err) {
                        reject(err);
                    } else {
                        try {
                            const p = JSON.parse(data);
                            this.playlist = p;
                            this.emit("changed");
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            } else {
                reject("No path");
            }
        });
    }

    skip(num) {
        if (num.length > 0) {
            let n = parseInt(num[0]);
            if (n == NaN)
                return false;
            // our playlist is 0 offset but tracks are 1 offset
            n -= 1;
            if (n >= 0 && n < this.playlist.length) {
                this.index = n;
                return true;
            }
        }
        return false;
    }

    current() {
        if (this.index < this.playlist.length)
            return this.playlist[this.index];
        return undefined;
    }

    hasMetadata(p) {
        return this.metadata.has(p);
    }

    setMetadata(p, meta) {
        this.metadata.set(p, meta);
    }

    getMetadata(path) {
        return this.metadata.get(path);
    }

    currentMetadata() {
        const p = this.current();
        if (!p)
            return undefined;
        return this.metadata.get(p);
    }

    next() {
        if (this.index + 1 < this.playlist.length) {
            ++this.index;
            return true;
        }
        return false;
    }

    previous() {
        if (this.index > 0) {
            --this.index;
            return true;
        }
        return false;
    }
}

module.exports = Playlist;
