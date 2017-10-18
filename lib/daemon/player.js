/*global require,module,setTimeout,process*/

"use strict";

const Playlist = require("./playlist");
const console = require("./console");
const colorize = require("./colorize");
const path = require("path");
const Speaker = require("speaker");
const escapes = require("ansi-escapes");
const { createReadStream } = require("fs");

const formats = {
    ".flac": require("@jhanssen/flac").FlacDecoder,
    ".mp3": require("lame").Decoder
};

function encoderFor(file)
{
    const ext = path.extname(file);
    if (ext in formats) {
        return new formats[ext]();
    }
    return null;
}

function cmd(argv)
{
    if (!argv._.length)
        return "";
    return argv._[0];
}

function args(argv)
{
    if (argv._.length <= 1)
        return [];
    return argv._.slice(1);
}

function wrapSpeaker(speaker) {
    speaker.removeListener("finish", speaker._flush);
    speaker._flush = () => {
        speaker.emit("flush");
        setTimeout(() => {
            speaker.close(true);
            speaker.emit("stopped");
        }, 500);
    };
    speaker.on("finish", speaker._flush);
    return speaker;
}

function closeReadStream(playing) {
    if (!playing.stream) return;
    //console.log("closing readplaying.stream", playing.stream);
    if (playing.stream.close) playing.stream.close();
    else if (playing.stream.destroy) playing.stream.destroy();
    playing.speaker.close(true);
}

function pad(str, n)
{
    for (let i = str.length; i < n; ++i)
        str += " ";
    return str;
}

function first(v) {
    if (v instanceof Array) {
        if (v.length > 0)
            return v[0];
        return undefined;
    }
    return v;
};

const player = {
    _playlist: new Playlist(Object.keys(formats)),
    _playing: { stream: undefined, speaker: undefined },

    handle: function(data) {
        return new Promise((resolve, reject) => {
            switch (cmd(data.argv)) {
            case "add":
                this._playlist.add(args(data.argv)).then(resolve).catch(reject);
                break;
            case "remove":
                this._playlist.remove(args(data.argv)).then(resolve).catch(reject);
                break;
            case "save":
                this._playlist.save(args(data.argv)).then(resolve).catch(reject);
                break;
            case "load":
                this._playlist.load(args(data.argv)).then(resolve).catch(reject);
                break;
            case "skip":
                if (this._playlist.skip(args(data.argv))) {
                    if (this._playing.stream) {
                        this._stop().then(() => {
                            this._play().then(resolve).catch(reject);
                        }).catch(reject);
                    } else {
                        this._play().then(resolve).catch(reject);
                    }
                } else {
                    resolve();
                }
                break;
            case "list":
                let playlist = this._playlist.playlist;
                let str = "";
                for (let i = 0; i < playlist.length; ++i) {
                    if (i == this._playlist.index) {
                        str += colorize.fg(4,0,1).next(pad((i + 1) + "", 4)).reset().format("");
                    } else {
                        str += colorize.fg(1,1,1).next(pad((i + 1) + "", 4)).reset().format("");
                    }
                    const meta = this._playlist.metadataFor(playlist[i]);
                    if (!meta) {
                        str += colorize.next(": ").fg(2,2,2).format(playlist[i]) + "\n";
                    } else {
                        const artist = first(meta.artist || meta.albumartist);
                        const title = first(meta.title);
                        str += ": ";
                        if (title) {
                            if (artist)
                                str += colorize.fg(3,3,3).next(artist).reset().format(" - ");
                            str += colorize.fg(2,2,2).format(title) + "\n";
                        } else {
                            str += colorize.fg(2,2,2).format(playlist[i]) + "\n";
                        }
                    }
                }
                resolve(str);
                break;
            case "playing":
                const fn = colorize.fg(1,1,1).next(pad("file", 15)).reset().next(": ").fg(2,2,2).format(path.basename(this._playlist.current() || ""));
                const dir = colorize.fg(1,1,1).next(pad("path", 15)).reset().next(": ").fg(2,2,2).format(path.dirname(this._playlist.current() || ""));
                const meta = this._playlist.currentMetadata();
                let metastr = "";
                let picturestr = "";
                for (let k in meta) {
                    switch (k) {
                    case "picture":
                        const p = first(meta[k]);
                        if (p) {
                            picturestr = colorize.fg(1,1,1).next(pad(k, 15)).reset().format(":");
                            picturestr += escapes.image(p.data, { width: "40%", height: "40%" });
                        }
                        break;
                    default:
                        metastr += colorize.fg(1,1,1).next(pad(k, 15)).reset().next(": ").fg(2,2,2).format(first(meta[k])) + "\n";
                        break;
                    }
                }
                resolve(fn + "\n" + dir + "\n" + metastr + picturestr);
                break;
            case "play":
                this._play().then(resolve).catch(reject);
                break;
            case "stop":
                this._stop().then(resolve).catch(reject);
                break;
            case "next":
                this._next().then(resolve).catch(reject);
                break;
            default:
                resolve(`unknown command ${cmd(data.argv)}`);
                break;
            }
        });
    },

    _play: function() {
        return new Promise((resolve, reject) => {
            if (this._playing.stream) {
                reject("already playing");
                return;
            }
            const file = this._playlist.current();
            if (typeof file === "string") {
                this._playing.stream = createReadStream(file);
                this._playing.speaker = wrapSpeaker(new Speaker);
                this._playing.stream
                    .pipe(encoderFor(file))
                    .pipe(wrapSpeaker(this._playing.speaker))
                    .on("stopped", () => {
                        //console.log("hey?");
                        this._playing.stream = undefined;
                        this._playing.speaker = undefined;
                        process.nextTick(() => { this._next().then(() => {}); });
                    });
            }
            resolve();
        });
    },

    _next: function() {
        return new Promise((resolve, reject) => {
            if (this._playing.stream) {
                closeReadStream(this._playing);
                this._playing.stream = undefined;
                this._playing.speaker = undefined;
            }
            if (this._playlist.next()) {
                this._play().then(resolve).catch(reject);
            }
            resolve();
        });
    },

    _stop: function() {
        return new Promise((resolve, reject) => {
            if (!this._playing.stream) {
                reject("not playing");
                return;
            }
            closeReadStream(this._playing);
            this._playing.stream = undefined;
            this._playing.speaker = undefined;
            resolve();
        });
    }
};

module.exports = player;
