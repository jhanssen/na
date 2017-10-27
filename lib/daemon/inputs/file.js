/*global process,module,require,setTimeout,clearTimeout*/

const fs = require("fs");
const path = require("path");
const mm = require("musicmetadata");
const appRoot = require("app-root-path");
const { createReadStream } = require("fs");

const console = require(appRoot + "/lib/daemon/console");

class FileItem
{
    constructor(p) {
        this._path = p;
        this._meta = undefined;
    }

    identifier() {
        return this._path;
    }

    stream() {
        return new Promise((resolve, reject) => {
            resolve(createReadStream(this._path));
        });
    }

    format() {
        return path.extname(this._path).substr(1).toLowerCase();
    }

    type() {
        return "file";
    }

    serialize() {
        return {
            path: this._path
        };
    }

    metadata() {
        return this._meta;
    }

    _setMetadata(m) {
        this._meta = m;
    }
}

function forEachFile(cwd, paths, each, done)
{
    let cur = 0;
    let num = 0;
    const next = (processed) => {
        const nextWithNum = () => {
            next(num);
        };
        num = processed;
        if (cur >= paths.length) {
            done(num);
            return;
        }
        // console.log("about to stat", paths[cur]);
        if (typeof paths[cur] !== "string") {
            ++cur;
            process.nextTick(nextWithNum);
            return;
        }
        let p;
        if (paths[cur].length > 0 && paths[cur][0] !== '/') {
            p = path.join(cwd, paths[cur]);
        } else {
            p = paths[cur];
        }
        fs.stat(p, (err, stats) => {
            if (err) {
                //console.error("failed to stat " + err, p);
                ++cur;
                process.nextTick(nextWithNum);
                return;
            }
            if (stats.isFile()) {
                ++num;
                ++cur;
                each(p);
                process.nextTick(nextWithNum);
            } else if (stats.isDirectory()) {
                ++cur;
                fs.readdir(p, (err, files) => {
                    if (err) {
                        process.nextTick(nextWithNum);
                        return;
                    }
                    forEachFile(cwd, files.map(f => path.join(p, f)), each, next);
                });
            } else {
                ++cur;
                process.nextTick(nextWithNum);
            }
        });
    };
    next(0);
}

const file = {
    _playlist: undefined,
    _metadata: { timer: undefined, processing: false },

    handle: function(cwd, cmd, args) {
        return new Promise((resolve, reject) => {
            switch (cmd) {
            case "add":
                file._add(cwd, args).then(resolve).catch(reject);
                break;
            case "remove":
                file._remove(cwd, args).then(resolve).catch(reject);
                break;
            default:
                reject(`Unknown command ${cmd}`);
                break;
            }
        });
    },

    name: function() { return "file"; },

    setup(playlist) {
        file._playlist = playlist;
        file._playlist.on("changed", file._processMetadata);
        file._playlist.registerDeserializer("file", function(item) {
            if (typeof item.path === "string")
                return new FileItem(item.path);
            return undefined;
        });
    },

    _add: function(cwd, paths) {
        return new Promise((resolve, reject) => {
            forEachFile(cwd, paths, p => {
                const fmt = path.extname(p).substr(1).toLowerCase();
                if (file._playlist.formats.has(fmt) && path.basename(p).substr(0, 2) !== "._")
                    file._playlist.add(new FileItem(p));
            }, (count, err) => {
                if (err) {
                    reject(err);
                    return;
                }
                file._processMetadata();
                resolve();
            });
        });
    },

    _remove: function(cwd, paths) {
        return new Promise((resolve, reject) => {
            forEachFile(cwd, paths, path => {
                for (let i = 0; i < file._playlist.playlist.length; ++i) {
                    if (file._playlist.playlist[i]._path == path) {
                        file._playlist.playlist.splice(i, 1);
                        file._playlist.removed(i);
                        return;
                    }
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
                    file._playlist.remove(paths).then(resolve).catch(reject);
                }
            });
        });
    },

    _processMetadata() {
        if (file._metadata.processing)
            return;
        if (file._metadata.timer)
            clearTimeout(file._metadata.timer);

        const nextMeta = () => {
            for (let i = 0; i < file._playlist.playlist.length; ++i) {
                const item = file._playlist.playlist[i];
                if (item.type() !== "file")
                    continue;
                if (item.metadata() === undefined) {
                    item._setMetadata(null);
                    const stream = fs.createReadStream(item._path);
                    mm(stream, (err, metadata) => {
                        if (err) {
                            nextMeta();
                            return;
                        }
                        if (metadata)
                            item._setMetadata(metadata);
                        stream.close();
                        nextMeta();
                    });
                    return;
                }
            }
            file._metadata.processing = false;
        };

        file._metadata.timer = setTimeout(() => {
            file._metadata.timer = undefined;
            file._metadata.processing = true;
            nextMeta();
        }, 500);
    }
};

module.exports = file;
