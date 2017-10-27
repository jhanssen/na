/*global require,module,setTimeout,process*/

"use strict";

const appRoot = require("app-root-path");
const Playlist = require(appRoot + "/lib/daemon/playlist");
const console = require(appRoot + "/lib/daemon/console");
const output = require(appRoot + "/lib/daemon/output");
const path = require("path");
const chalk = require("chalk");
const Speaker = require("speaker");
const escapes = require("ansi-escapes");
const semver = require("semver");
const { Multiply } = require("@jhanssen/multiply-pcm");

const isITerm = (process.env.TERM_PROGRAM == "iTerm.app" && semver.gte(process.env.TERM_PROGRAM_VERSION, "3.0.0"));

const formats = {
    flac: require("@jhanssen/flac").FlacDecoder,
    mp3: require("lame").Decoder
};

function decoderFor(fmt)
{
    if (fmt in formats) {
        return new formats[fmt]();
    }
    return null;
}

function cmd(argv)
{
    if (!argv.length)
        return "";
    return argv[0];
}

function args(argv)
{
    if (argv.length <= 1)
        return [];
    return argv.slice(1);
}

function firstArg(argv)
{
    if (argv.length <= 1)
        return undefined;
    return argv[1];
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
        playing.decoder.unpipe();
        playing.multiplier.unpipe();
        playing.stream.unpipe();
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
    _playing: { stream: undefined, decoder: undefined, multiplier: undefined, speaker: undefined, stopping: false },
    _listTemplate: undefined,
    _listTheme: undefined,
    _playingTemplate: undefined,
    _playingTheme: undefined,
    _inputs: [],
    _input: undefined,
    _gain: 1,

    handle: function(data) {
        return new Promise((resolve, reject) => {
            switch (cmd(data.argv._)) {
            case "set":
                this._set(args(data.argv._)).then(resolve).catch(reject);
                break;
            case "clear":
                this._playlist.clear();
                resolve();
                break;
            case "save":
                this._playlist.save(data.cwd, args(data.argv._)).then(resolve).catch(reject);
                break;
            case "load":
                this._playlist.load(data.cwd, args(data.argv._)).then(resolve).catch(reject);
                break;
            case "gain": {
                const g = firstArg(data.argv._);
                if (typeof g === "number" && !isNaN(g)) {
                    this._gain = g;
                    if (this._playing.multiplier) {
                        this._playing.multiplier.setGain(g);
                    }
                    resolve();
                    return;
                }
                reject(`Invalid gain ${g}`);
                break; }
            case "list": {
                const filters = args(data.argv._).map(f => new RegExp(f, "i"));

                let playlist = this._playlist.playlist;
                let output = this._listTemplate.new();
                let lastalbum = {};
                const albumData = meta => {
                    if (!meta)
                        return {};
                    return {
                        artist: first(meta.albumartist) || first(meta.artist),
                        album: first(meta.album)
                    };
                };
                const match = (meta, identifier, filters) => {
                    if (!filters.length)
                        return true;
                    if (!meta && !identifier) {
                        // this shouldn't really happen
                        return false;
                    }
                    const metas = [];
                    if (meta) {
                        for (let k in meta) {
                            switch (typeof first(meta[k])) {
                            case "string":
                            case "number":
                                metas.push(meta[k]);
                                break;
                            default:
                                break;
                            }
                        }
                    }
                    for (let f = 0; f < filters.length; ++f) {
                        const filter = filters[f];
                        if (identifier && filter.test(identifier))
                            return true;
                        for (let k = 0; k < metas.length; ++k) {
                            if (filter.test(metas[k]))
                                return true;
                        }
                    }
                    return false;
                };
                for (let i = 0; i < playlist.length; ++i) {
                    const meta = playlist[i].metadata();
                    if (!match(meta, playlist[i].identifier(), filters))
                        continue;
                    const album = albumData(meta);
                    if (album.artist !== lastalbum.artist || album.album !== lastalbum.album) {
                        lastalbum = album;
                        if (album.artist) {
                            output.noauto().override("albumartist", album.artist);
                            if (album.album) {
                                output.override("albumsep", " - ").override("albumalbum", album.album).end();
                            } else {
                                output.end();
                            }
                        } else {
                            output.noauto().override("albumalbum", album.album ? album.album : "").end();
                        }
                    }
                    if (i == this._playlist.index) {
                        output.override("active", i + 1);
                    } else {
                        output.add(i + 1);
                    }
                    if (!meta) {
                        output.override("title", playlist[i].identifier()).end();
                    } else {
                        const artist = first(meta.artist) || first(meta.albumartist);
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
                resolve(output.format(this._listTheme) || "no matches");
                break; }
            case "playing": {
                if (!this._playing.stream) {
                    resolve("nothing is playing");
                    return;
                }
                let output = this._playingTemplate.new();
                output.add("identifier").add(path.basename(this._playlist.current().identifier() || ""));
                const meta = this._playlist.currentMetadata();
                if (meta) {
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
                            const f = first(meta[k]);
                            if (typeof f !== "undefined")
                                output.add(k).add(f);
                            break;
                        }
                    }
                    if (picturestr) {
                        output.add("picture").override("picture", picturestr);
                    }
                }
                resolve(output.format(this._playingTheme) || "nothing is playing");
                break; }
            case "play":
                if (this._playlist.skip(args(data.argv._))) {
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
            default: {
                // if cmd is an input name then use that, otherwise use the default input
                const c = cmd(data.argv._);
                for (let i = 0; i < this._inputs.length; ++i) {
                    if (this._inputs[i].name() == c) {
                        const nargs = args(data.argv._);
                        console.log("baff", nargs);
                        this._inputs[i].handle(data.cwd, cmd(nargs), args(nargs)).then(resolve).catch(reject);
                        return;
                    }
                }
                if (this._input) {
                    this._input.handle(data.cwd, c, args(data.argv._)).then(resolve).catch(reject);
                } else {
                    reject("No input handler");
                }
                break; }
            }
        });
    },

    setup: function() {
        this._setupInputs();
        this._input = this._inputs[0];

        this._listTemplate = new output.Template();
        this._listTemplate.add("track").auto(":").pad(6).add("artist").auto(" - ").add("title");
        this._listTheme = new output.Theme();
        this._listTheme
            .style("track", chalk.rgb(80, 80, 80))
            .style("artist", chalk.rgb(128, 128, 128))
            .style("title", chalk.rgb(180, 180, 180))
            .style("active", chalk.rgb(200, 100, 100))
            .style("albumartist", chalk.rgb(128, 180, 128))
            .style("albumalbum", chalk.rgb(180, 255, 180));

        this._playingTemplate = new output.Template();
        this._playingTemplate.add("type").auto(":").pad(20).add("value");
        this._playingTheme = new output.Theme();
        this._playingTheme
            .style("type", chalk.rgb(80,80,80))
            .style("value", chalk.rgb(180, 180, 180));
    },

    _setupInputs: function() {
        const inputs = ["file", "gmusic"];
        inputs.forEach(input => {
            const i = require(appRoot + `/lib/daemon/inputs/${input}`);
            i.setup(this._playlist);
            this._inputs.push(i);
        });
    },

    _set: function(args) {
        return new Promise((resolve, reject) => {
            if (!args || !args.length) {
                reject("no args");
                return;
            }
            switch (args[0]) {
            case "input":
                if (args.length < 2) {
                    reject("set input needs an argument");
                    return;
                }
                for (let i = 0; i < this._inputs.length; ++i) {
                    if (this._inputs[i].name() === args[1]) {
                        this._input = this._inputs[i];
                        resolve(`input set to ${args[1]}`);
                        return;
                    }
                }
                reject(`no input named ${args[1]}`);
                break;
            default:
                reject(`unrecognized set: ${args[0]}`);
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
            if (typeof file.stream === "function") {
                file.stream().then(stream => {
                    this._playing.stream = stream;
                    this._playing.decoder = decoderFor(file.format());
                    this._playing.multiplier = new Multiply({ gain: this._gain });
                    this._playing.speaker = wrapSpeaker(new Speaker);
                    this._playing.stream
                        .pipe(this._playing.decoder)
                        .pipe(this._playing.multiplier)
                        .pipe(this._playing.speaker)
                        .on("stopped", () => {
                            //console.log("hey?");
                            this._playing.stream = undefined;
                            this._playing.decoder = undefined;
                            this._playing.multiplier = undefined;
                            this._playing.speaker = undefined;
                            process.nextTick(() => { this._next().then(() => {}); });
                        });
                    resolve();
                }).catch(err => {
                    reject("unable to create stream " + err);
                });
            } else {
                reject("invalid playlist item");
            }
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
                    this._playing.decoder = undefined;
                    this._playing.multiplier = undefined;
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
                this._playing.decoder = undefined;
                this._playing.multiplier = undefined;
                this._playing.speaker = undefined;
                this._playing.stopping = false;
                resolve();
            }).catch(reject);
        });
    }
};

module.exports = player;
