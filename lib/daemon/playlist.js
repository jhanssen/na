/*global require,module,process,setTimeout,clearTimeout*/

"use strict";

const fs = require("fs");
const path = require("path");
const mm = require('musicmetadata');

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
        this.metadata = { timer: undefined, processing: false, data: new Map() };
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
                this._processMetadata();
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

    list(path) {
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
                        if (err)
                            return;
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