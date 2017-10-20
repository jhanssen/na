/*global require,module,setTimeout,process*/

"use strict";

const Playlist = require("./playlist");
const console = require("./console");
const path = require("path");
const output = require("./output");
const chalk = require("chalk");
const Speaker = require("speaker");
const escapes = require("ansi-escapes");
const { createReadStream } = require("fs");

const isITerm = (process.env.TERM_PROGRAM == "iTerm.app");

const formats = {
    ".flac": require("@jhanssen/flac").FlacDecoder,
    ".mp3": require("lame").Decoder
};

function decoderFor(file)
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
    return new Promise((resolve, reject) => {
        if (!playing.stream) { resolve(); return; }
        //console.log("closing readplaying.stream", playing.stream);
        playing.speaker.close(true);
        setTimeout(() => {
            if (playing.stream.close) playing.stream.close();
            else if (playing.stream.destroy) playing.stream.destroy();
            resolve();
        }, 500);
    });
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
    _playing: { stream: undefined, speaker: undefined, stopping: false },
    _listTemplate: undefined,
    _listTheme: undefined,
    _playingTemplate: undefined,
    _playingTheme: undefined,

    handle: function(data) {
        return new Promise((resolve, reject) => {
            switch (cmd(data.argv)) {
            case "add":
                this._playlist.add(data.cwd, args(data.argv)).then(resolve).catch(reject);
                break;
            case "remove":
                this._playlist.remove(data.cwd, args(data.argv)).then(resolve).catch(reject);
                break;
            case "clear":
                this._playlist.clear();
                resolve();
                break;
            case "save":
                this._playlist.save(data.cwd, args(data.argv)).then(resolve).catch(reject);
                break;
            case "load":
                this._playlist.load(data.cwd, args(data.argv)).then(resolve).catch(reject);
                break;
            case "list": {
                let playlist = this._playlist.playlist;
                let output = this._listTemplate.new();
                for (let i = 0; i < playlist.length; ++i) {
                    if (i == this._playlist.index) {
                        output.override("active", i + 1);
                    } else {
                        output.add(i + 1);
                    }
                    const meta = this._playlist.metadataFor(playlist[i]);
                    if (!meta) {
                        output.override("title", playlist[i]).end();
                    } else {
                        const artist = first(meta.artist || meta.albumartist);
                        const title = first(meta.title);
                        if (title) {
                            if (artist) {
                                output.add(artist).add(title);
                            } else {
                                output.override("title", title).end();
                            }
                        } else {
                            output.override("title", playlist[i]).end();
                        }
                    }
                }
                resolve(output.format(this._listTheme));
                break; }
            case "playing": {
                let output = this._playingTemplate.new();
                output.add("file").add(path.basename(this._playlist.current() || ""));
                output.add("path").add(path.dirname(this._playlist.current() || ""));
                const meta = this._playlist.currentMetadata();
                let picturestr;
                for (let k in meta) {
                    switch (k) {
                    case "picture":
                        if (isITerm) {
                            const p = first(meta[k]);
                            if (p) {
                                picturestr = escapes.image(p.data, { width: "40%", height: "40%" });
                            }
                        }
                        break;
                    default:
                        output.add(k).add(first(meta[k]));
                        break;
                    }
                }
                if (picturestr) {
                    output.add("picture").override("picture", picturestr);
                }
                resolve(output.format(this._playingTheme));
                break; }
            case "play":
                if (this._playlist.skip(args(data.argv))) {
                    if (this._playing.stream) {
                        this._stop().then(() => {
                            this._play().then(resolve).catch(reject);
                        }).catch(reject);
                    } else {
                        this._play().then(resolve).catch(reject);
                    }
                } else {
                    this._play().then(resolve).catch(reject);
                }
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

    setup: function() {
        this._listTemplate = new output.Template();
        this._listTemplate.add("track").auto(":").pad(4).add("artist").auto(" : ").add("title");
        this._listTheme = new output.Theme();
        this._listTheme
            .style("track", chalk.rgb(80, 80, 80))
            .style("artist", chalk.rgb(128, 128, 128))
            .style("title", chalk.rgb(180, 180, 180))
            .style("active", chalk.rgb(200, 100, 100));

        this._playingTemplate = new output.Template();
        this._playingTemplate.add("type").auto(":").pad(20).add("value");
        this._playingTheme = new output.Theme();
        this._playingTheme
            .style("type", chalk.rgb(80,80,80))
            .style("value", chalk.rgb(180, 180, 180));
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
                    .pipe(decoderFor(file))
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
            const next = () => {
                if (this._playlist.next()) {
                    this._play().then(resolve).catch(reject);
                }
                resolve();
            };
            if (this._playing.stopping) {
                reject("stop already in progress");
                return;
            }
            if (this._playing.stream) {
                this._playing.stopping = true;
                closeReadStream(this._playing).then(() => {
                    this._playing.stream = undefined;
                    this._playing.speaker = undefined;
                    this._playing.stopping = false;
                    next();
                }).catch(reject);
            } else {
                next();
            }
        });
    },

    _stop: function() {
        return new Promise((resolve, reject) => {
            if (!this._playing.stream) {
                reject("not playing");
                return;
            }
            if (this._playing.stopping) {
                reject("stop already in progress");
                return;
            }
            this._playing.stopping = true;
            closeReadStream(this._playing).then(() => {
                this._playing.stream = undefined;
                this._playing.speaker = undefined;
                this._playing.stopping = false;
                resolve();
            }).catch(reject);
        });
    }
};

module.exports = player;
