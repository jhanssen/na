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

        this.deserializers = new Map();
        this.playlist = [];
        this.index = 0;
        this.exts = new Set();
        for (let i = 0; i < exts.length; ++i) {
            this.exts.add(exts[i]);
        }
    }

    registerDeserializer(type, deser) {
        this.deserializers.set(type, deser);
    }

    add(item) {
        this.playlist.push(item);
    }

    remove(items) {
        const toremove = item => {
            if (typeof item !== "string")
                return [item, 1];
            const dash = item.indexOf("-");
            if (dash === -1) {
                const start = parseInt(item);
                if (!isNaN(start)) {
                    return [start, 1];
                }
                return undefined;
            }
            const start = parseInt(item.substr(0, dash));
            if (!isNaN(start)) {
                const end = parseInt(item.substr(dash + 1));
                if (!isNaN(end)) {
                    return [start, (end - start) + 1];
                }
            }
            return undefined;
        };

        return new Promise((resolve, reject) => {
            // no paths process, let's see if we can remove items by number
            let delta = 0;
            for (let i = 0; i < items.length; ++i) {
                const r = toremove(items[i]);
                if (!r) {
                    reject("Invalid remove entry (empty)");
                    return;
                }
                const start = r[0] - delta - 1;
                if (!this._remove(start, r[1])) {
                    reject("Invalid remove entry", start, r[1]);
                    return;
                }
                delta += r[1];
            }
            resolve();
        });
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
        return p.metadata() !== undefined;
    }

    setMetadata(p, meta) {
        p.setMetadata(meta);
    }

    getMetadata(p) {
        return p.metadata();
    }

    currentMetadata() {
        const p = this.current();
        if (!p)
            return undefined;
        return p.metadata();
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

    _remove(start, num) {
        if (typeof num !== "number") {
            // bad
            return false;
        }
        if (start < 0 || start + num >= this.playlist.length)
            return false;
        this.playlist.splice(start, num);
        return true;
    }
}

module.exports = Playlist;
