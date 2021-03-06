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
    constructor(formats) {
        super();

        this.deserializers = new Map();
        this.playlist = [];
        this.index = 0;
        this.formats = new Set();
        for (let i = 0; i < formats.length; ++i) {
            this.formats.add(formats[i]);
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

    removed(idx) {
        if (idx < this.index) {
            --this.index;
        } else if (idx == this.index) {
            this.index = (this.index * -1) - 1;
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
                const tosave = this.playlist.map(e => { let s = e.serialize(); s.type = e.type(); return s; });
                fs.writeFile(p, JSON.stringify(tosave, null, 2), err => {
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
                        let p;
                        try {
                            p = JSON.parse(data);
                        } catch (e) {
                            reject(e);
                            return;
                        }
                        this.playlist = p.map(e => {
                            const deser = this.deserializers.get(e.type);
                            if (deser)
                                return deser(e);
                            return undefined;
                        }).filter(e => typeof e === "object");
                        this.emit("changed");
                        resolve();
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
        if (this.index >= 0 && this.index < this.playlist.length)
            return this.playlist[this.index];
        return undefined;
    }

    currentMetadata() {
        const p = this.current();
        if (!p)
            return undefined;
        return p.metadata();
    }

    next() {
        const idx = this.index < 0 ? (this.index * -1) - 1 : this.index;
        if (idx + 1 < this.playlist.length) {
            this.index = idx + 1;
            return true;
        }
        return false;
    }

    previous() {
        const idx = this.index < 0 ? (this.index * -1) - 1 : this.index;
        if (idx > 0) {
            this.index = idx - 1;
            return true;
        }
        return false;
    }

    _remove(start, num) {
        if (typeof num !== "number") {
            // bad
            return false;
        }
        if (start < 0 || start + num > this.playlist.length)
            return false;
        this.playlist.splice(start, num);
        if (this.index >= 0 && start <= this.index) {
            if (start + num > this.index) {
                this.index = -start - 1;
            } else {
                this.index -= num;
            }
        }
        return true;
    }
}

module.exports = Playlist;
