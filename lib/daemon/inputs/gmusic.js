/*global process,module,require*/

const ConfigStore = require("configstore");
const PlayMusic = require("playmusic");
const appRoot = require("app-root-path");
const chalk = require("chalk");
const request = require("request");

const console = require(appRoot + "/lib/daemon/console");
const output = require(appRoot + "/lib/daemon/output");

const conf = new ConfigStore("na-gmusic");
const pm = new PlayMusic();

class GMusicItem
{
    constructor(i) {
        this._item = i;
    }

    identifier() {
        return this.path;
    }

    stream() {
        return new Promise((resolve, reject) => {
            pm.getStreamUrl(this._item.storeId, (err, url) => {
                if (err) {
                    reject("unable to get url for " + this._item.storeId);
                    return;
                }
                resolve(request(url));
            });
        });
    }

    format() {
        return "mp3";
    }

    type() {
        return "file";
    }

    serialize() {
        return {
            path: this.path
        };
    }

    metadata() {
        return {
            artist: this._item.artist,
            albumartist: this._item.albumArtist,
            title: this._item.title
        };
    }
}

const gmusic = {
    _inited: false,
    _results: undefined,
    _playlist: undefined,

    name: function() { return "gmusic"; },

    handle: function(cwd, cmd, args) {
        return new Promise((resolve, reject) => {
            if (!gmusic._inited) {
                reject("gmusic not yet inited");
                return;
            }
            switch (cmd) {
            case "search":
                pm.search(args.join(" "), 5, (err, data) => {
                    if (err) {
                        reject("gmusic search " + err);
                        return;
                    }
                    this._results = data.entries.filter(item => {
                        return item.type == "1" || item.type == "3";
                    });
                    this._showResults(resolve, reject);
                });
                break;
            case "results":
                if (!this._results) {
                    reject("no results");
                    return;
                }
                this._showResults(resolve, reject);
                break;
            case "add": {
                if (!this._results) {
                    reject("no results, use search first");
                    return;
                }
                for (let i = 0; i < args.length; ++i) {
                    let no = parseInt(args[i]);
                    if (!isNaN(no)) {
                        // add this item
                        if (no < 0 || no >= this._results.length) {
                            reject(`item ${no} out of range`);
                            return;
                        }
                        const item = this._results[no];
                        switch (item.type) {
                        case "1":
                            gmusic._playlist.add(new GMusicItem(item.track));
                            resolve("added " + item.track.title);
                            return;
                        }
                    }
                }
                reject("unable to add");
                break; }
            default:
                reject(`Unknown command ${cmd}`);
                break;
            }
        });
    },

    setup(playlist) {
        this._resultsTemplate = new output.Template();
        this._resultsTemplate.add("no").auto(":").pad(6).add("type").auto(" - ").add("name");
        this._resultsTheme = new output.Theme();
        this._resultsTheme
            .style("no", chalk.rgb(80, 80, 80))
            .style("type", chalk.rgb(128, 128, 128))
            .style("name", chalk.rgb(180, 180, 180));

        const init = (androidId, masterToken) => {
            console.log("gmusic initing");
            pm.init({ androidId: androidId, masterToken: masterToken }, err => {
                if (err) {
                    console.error("gmusic error initing", err);
                    return;
                }
                console.log("gmusic inited");
                gmusic._inited = true;

                gmusic._playlist = playlist;
                gmusic._playlist.on("changed", gmusic._processMetadata);
                gmusic._playlist.registerDeserializer("gmusic", function(item) {
                    if (typeof item.path === "string")
                        return new GMusicItem(item.path);
                    return undefined;
                });
            });
        };

        // if we don't have an android id and master token, make one
        if (!conf.has("androidId") || !conf.has("masterToken")) {
            if (!conf.has("email") || !conf.has("password")) {
                console.error("gmusic no email and password");
                return;
            }
            console.log("gmusic no id and/or token, generating");
            pm.login({ email: conf.get("email"), password: conf.get("password") }, (err, resp) => {
                if (err) {
                    console.error("gmusic error logging in", err);
                    return;
                }
                conf.set("androidId", resp.androidId);
                conf.set("masterToken", resp.masterToken);
                init(resp.androidId, resp.masterToken);
            });
        } else {
            init(conf.get("androidId"), conf.get("masterToken"));
        }
    },

    _showResults(resolve, reject) {
        let output = this._resultsTemplate.new();
        for (let i = 0; i < this._results.length; ++i) {
            output.add(i + 1);
            switch (this._results[i].type) {
            case "1":
                output.add("track").add(this._results[i].track.title);
                break;
            case "3":
                output.add("album").add(this._results[i].album.name);
                break;
            }
        }
        resolve(output.format(this._resultsTheme) || "no results");
    },

    _processMetadata() {
    }
};

module.exports = gmusic;
