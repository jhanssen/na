/*global require,module,setTimeout,process*/

"use strict";

const Playlist = require("./playlist");
const console = require("./console");
const path = require("path");
const Speaker = require("speaker");
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

const player = {
    _playlist: new Playlist(Object.keys(formats)),
    _playing: { stream: undefined, speaker: undefined },
    _stopped: false,

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
            case "playing":
                resolve(this._playlist.current() || "");
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
                        if (this._stopped) {
                            this._stopped = false;
                            return;
                        }
                        process.nextTick(() => { this._next().then(() => {}); });
                    });
            }
            resolve();
        });
    },

    _next: function() {
        return new Promise((resolve, reject) => {
            if (this._playing.stream) {
                this._stopped = false;
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
            this._stopped = true;
            closeReadStream(this._playing);
            this._playing.stream = undefined;
            this._playing.speaker = undefined;
            resolve();
        });
    }
};

module.exports = player;
