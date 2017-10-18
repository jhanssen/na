/*global require,module,process*/

"use strict";

const fs = require("fs");
const path = require("path");

const console = require("./console");

function forEachFile(paths, each, done)
{
    let cur = 0;
    let next = () => {
        if (cur >= paths.length) {
            // console.log("done");
            done();
            return;
        }
        // console.log("about to stat", paths[cur]);
        fs.stat(paths[cur], (err, stats) => {
            if (err) {
                console.error("failed to stat " + err, paths[cur++]);
                return;
            }
            if (stats.isFile()) {
                each(paths[cur++]);
                process.nextTick(next);
            } else if (stats.isDirectory()) {
                const p = paths[cur++];
                fs.readdir(p, (err, files) => {
                    if (err) {
                        process.nextTick(next);
                        return;
                    }
                    forEachFile(files.map(f => path.join(p, f)), each, next);
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
        this.playlist = [];
        this.index = 0;
        this.exts = new Set();
        for (let i = 0; i < exts.length; ++i) {
            this.exts.add(exts[i]);
        }
    }

    add(paths) {
        return new Promise((resolve, reject) => {
            forEachFile(paths, p => {
                // console.log("got path", path);
                if (this.exts.has(path.extname(p)) && path.basename(p).substr(0, 2) !== "._")
                    this.playlist.push(p);
            }, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    remove(paths) {
        return new Promise((resolve, reject) => {
            forEachFile(paths, path => {
                const idx = this.playlist.indexOf(path);
                if (idx !== -1) {
                    this.playlist.splice(idx, 1);
                }
            }, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    save(path) {
    }

    load(path) {
    }

    current() {
        if (this.index < this.playlist.length)
            return this.playlist[this.index];
        return undefined;
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
