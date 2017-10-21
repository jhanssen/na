/*global require,module,process,setTimeout,clearTimeout*/

"use strict";

const fs = require("fs");
const path = require("path");
const homedir = require("homedir");
const mm = require('musicmetadata');

const console = require("./console");

function forEachFile(cwd, paths, each, done)
{
    let cur = 0;
    let num = 0;
    let next = () => {
        if (cur >= paths.length) {
            // console.log("done");
            done(num);
            return;
        }
        // console.log("about to stat", paths[cur]);
        if (typeof paths[cur] !== "string") {
            ++cur;
            process.nextTick(next);
            return;
        }
        let p;
        //paths = paths.map(p => { if (typeof p !== "string" || !p.length || p[0] === '/') return p; return path.join(cwd, p); });
        if (paths[cur].length > 0 && paths[cur][0] !== '/') {
            p = path.join(cwd, paths[cur]);
        } else {
            p = paths[cur];
        }
        fs.stat(p, (err, stats) => {
            if (err) {
                //console.error("failed to stat " + err, p);
                ++cur;
                process.nextTick(next);
                return;
            }
            if (stats.isFile()) {
                ++num;
                ++cur;
                each(p);
                process.nextTick(next);
            } else if (stats.isDirectory()) {
                ++cur;
                fs.readdir(p, (err, files) => {
                    if (err) {
                        process.nextTick(next);
                        return;
                    }
                    forEachFile(cwd, files.map(f => path.join(p, f)), each, next);
                });
            } else {
                ++cur;
                process.nextTick(next);
            }
        });
    };
    next();
}

class Playlist
{
    constructor(exts) {
        this.metadata = { timer: undefined, processing: false, data: new Map() };
        this.playlist = [];
        this.index = 0;
        this.exts = new Set();
        for (let i = 0; i < exts.length; ++i) {
            this.exts.add(exts[i]);
        }
    }

    add(cwd, paths) {
        return new Promise((resolve, reject) => {
            forEachFile(cwd, paths, p => {
                // console.log("got path", path);
                if (this.exts.has(path.extname(p)) && path.basename(p).substr(0, 2) !== "._")
                    this.playlist.push(p);
            }, (count, err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this._processMetadata();
                resolve();
            });
        });
    }

    remove(cwd, paths) {
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
            forEachFile(cwd, paths, path => {
                const idx = this.playlist.indexOf(path);
                if (idx !== -1) {
                    this.playlist.splice(idx, 1);
                }
            }, (count, err) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (count > 0) {
                    // done
                    resolve();
                } else {
                    // no paths process, let's see if we can remove items by number
                    let delta = 0;
                    for (let i = 0; i < paths.length; ++i) {
                        const r = toremove(paths[i]);
                        if (!r) {
                            reject("Invalid remove entry (empty)");
                            return;
                        }
                        const start = r[0] - delta - 1;
                        if (start < 0 || start >= this.playlist.length) {
                            reject("Invalid remove entry", start, r[1]);
                            return;
                        }
                        this.playlist.splice(start, r[1]);
                        delta += r[1];
                    }
                    resolve();
                }
            });
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
                            this._processMetadata();
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

    currentMetadata() {
        const p = this.current();
        if (!p)
            return undefined;
        return this.metadata.data.get(p);
    }

    metadataFor(path) {
        return this.metadata.data.get(path);
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

    _processMetadata() {
        if (this.metadata.processing)
            return;
        if (this.metadata.timer)
            clearTimeout(this.metadata.timer);

        const nextMeta = () => {
            for (let i = 0; i < this.playlist.length; ++i) {
                const path = this.playlist[i];
                if (!this.metadata.data.has(path)) {
                    this.metadata.data.set(path, undefined);
                    const stream = fs.createReadStream(path);
                    mm(stream, (err, metadata) => {
                        if (err) {
                            nextMeta();
                            return;
                        }
                        if (metadata)
                            this.metadata.data.set(path, metadata);
                        stream.close();
                        nextMeta();
                    });
                    return;
                }
            }
            this.metadata.processing = false;
        };

        this.metadata.timer = setTimeout(() => {
            this.metadata.timer = undefined;
            this.metadata.processing = true;
            nextMeta();
        }, 500);
    }
}

module.exports = Playlist;
