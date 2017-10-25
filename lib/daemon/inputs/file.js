/*global process,module,require,setTimeout,clearTimeout*/

const fs = require("fs");
const path = require("path");
const mm = require("musicmetadata");
const appRoot = require("app-root-path");

const console = require(appRoot + "/lib/daemon/console");

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

    setPlaylist(playlist) {
        file._playlist = playlist;
        file._playlist.on("changed", file._processMetadata);
    },

    _add: function(cwd, paths) {
        return new Promise((resolve, reject) => {
            forEachFile(cwd, paths, p => {
                if (file._playlist.exts.has(path.extname(p)) && path.basename(p).substr(0, 2) !== "._")
                    file._playlist.add(p);
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
                file._playlist.remove(path);
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
                        if (!file._playlist.remove(start, r[1])) {
                            reject("Invalid remove entry", start, r[1]);
                            return;
                        }
                        delta += r[1];
                    }
                    resolve();
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
                const path = file._playlist.playlist[i];
                if (!file._playlist.hasMetadata(path)) {
                    file._playlist.setMetadata(path, undefined);
                    const stream = fs.createReadStream(path);
                    mm(stream, (err, metadata) => {
                        if (err) {
                            nextMeta();
                            return;
                        }
                        if (metadata)
                            file._playlist.setMetadata(path, metadata);
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
