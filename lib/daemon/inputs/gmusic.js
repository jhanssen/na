/*global process,module,require,Buffer*/

const ConfigStore = require("configstore");
const PlayMusic = require("playmusic");
const appRoot = require("app-root-path");
const chalk = require("chalk");
const request = require("request");

const console = require(appRoot + "/lib/daemon/console");
const output = require(appRoot + "/lib/daemon/output");
const { BufferReadStream } = require(appRoot + "/lib/daemon/bufferstream");

const conf = new ConfigStore("na-gmusic");
const pm = new PlayMusic();

function artRef(item) {
    if (item && item.albumArtRef && item.albumArtRef.length > 0) {
        return item.albumArtRef[0].url;
    }
    return undefined;
}

class GMusicItem
{
    constructor(i, artCache) {
        this._item = i;
        this._artCache = artCache;
    }

    identifier() {
        return this._item.storeId;
    }

    stream() {
        return new Promise((resolve, reject) => {
            pm.getStreamUrl(this._item.storeId, (err, url) => {
                if (err) {
                    reject("unable to get url for " + this._item.storeId);
                    return;
                }
                resolve(new BufferReadStream({ url: url }));
            });
        });
    }

    format() {
        return "mp3";
    }

    type() {
        return "gmusic";
    }

    serialize() {
        return this._item;
    }

    metadata() {
        let picture = undefined;
        const ref = artRef(this._item);
        if (ref) {
            const data = this._artCache.get(ref);
            if (data instanceof Buffer) {
                picture = { data: data };
            }
        }
        return {
            artist: this._item.artist,
            albumartist: this._item.albumArtist,
            album: this._item.album,
            title: this._item.title,
            picture: picture
        };
    }
}

const gmusic = {
    _inited: false,
    _results: undefined,
    _playlist: undefined,
    _artCache: new Map(),

    name: function() { return "gmusic"; },

    handle: function(cwd, cmd, args) {
        return new Promise((resolve, reject) => {
            if (!gmusic._inited) {
                reject("gmusic not yet inited");
                return;
            }
            switch (cmd) {
            case "search":
                if (!args.length) {
                    reject("need an argument");
                    return;
                }
                // if first arg is a number then use that as our limit
                let limit = parseInt(args[0]);
                if (!isNaN(limit) && limit + "" == args[0]) {
                    args.splice(0, 1);
                } else {
                    limit = 5;
                }

                pm.search(args.join(" "), limit, (err, data) => {
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
                        // no is 1 indexed while array is 0 indexed
                        --no;
                        // add this item
                        if (no < 0 || no >= this._results.length) {
                            reject(`item ${no} out of range`);
                            return;
                        }
                        const item = this._results[no];
                        switch (item.type) {
                        case "1": {
                            const gitem = new GMusicItem(item.track, gmusic._artCache);
                            gmusic._playlist.add(gitem);
                            gmusic._ensureArt(gitem);
                            resolve("added track " + item.track.title);
                            return; }
                        case "3":
                            pm.getAlbum(item.album.albumId, true, (err, album) => {
                                if (err) {
                                    reject("unable to get album " + err);
                                    return;
                                }
                                for (let i = 0; i < album.tracks.length; ++i) {
                                    const gitem = new GMusicItem(album.tracks[i], gmusic._artCache);
                                    gmusic._playlist.add(gitem);
                                    gmusic._ensureArt(gitem);
                                }
                                resolve("added album " + album.name);
                            });
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

    setup: function(playlist) {
        this._resultsTemplate = new output.Template();
        this._resultsTemplate.add("no").auto(":").pad(6).add("type").auto(" => ").add("artist").auto(" - ").add("name");
        this._resultsTheme = new output.Theme();
        this._resultsTheme
            .style("no", chalk.rgb(80, 80, 80))
            .style("type", chalk.rgb(128, 128, 128))
            .style("artist", chalk.rgb(160, 160, 160))
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
                gmusic._playlist.registerDeserializer("gmusic", function(item) {
                    const gitem = new GMusicItem(item, gmusic._artCache);
                    gmusic._ensureArt(gitem);
                    return gitem;
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

    _showResults: function(resolve, reject) {
        let output = this._resultsTemplate.new();
        for (let i = 0; i < this._results.length; ++i) {
            output.add(i + 1);
            switch (this._results[i].type) {
            case "1":
                output.add("track").add(this._results[i].track.artist).add(this._results[i].track.title);
                break;
            case "3":
                output.add("album").add(this._results[i].album.artist).add(this._results[i].album.name);
                break;
            }
        }
        resolve(output.format(this._resultsTheme) || "no results");
    },

    _ensureArt: function(item) {
        const art = artRef(item._item);
        if (!art)
            return;
        if (!gmusic._artCache.has(art)) {
            gmusic._artCache.set(art, undefined);
            request({ url: art, encoding: null }, (error, response, body) => {
                if (error)
                    return;
                if (body instanceof Buffer) {
                    gmusic._artCache.set(art, body);
                }
            });
        }
    }
};

module.exports = gmusic;
