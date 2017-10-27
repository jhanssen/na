/*global process,module,require*/

const { Readable, Writable } = require("stream");
const request = require("request");

class BufferWriteStream extends Writable
{
    constructor(options) {
        super(options);

        this._read = options.readStream;
        this._chunks = [];
    }

    _write(chunk, encoding, done) {
        this._chunks.push(chunk);
        process.nextTick(done);

        this._read._process();
    }
}

class BufferReadStream extends Readable
{
    constructor(options) {
        super(options);

        this._write = new BufferWriteStream({ readStream: this });
        this._url = options.url;
        this._pendingRead = false;
        this._done = false;

        request
            .get(this._url)
            .on("error", err => {
                console.error("buffer read stream error", err);
            })
            .on("end", () => {
                this._done = true;
                if (!this._write._chunks.length) {
                    this._write = undefined;
                    this.push(null);
                }
            })
            .pipe(this._write);
    }

    _read(size) {
        this._pendingRead = true;
        this._process();
    }

    _process() {
        if (!this._pendingRead)
            return;
        while (this._write._chunks.length > 0) {
            if (!this.push(this._write._chunks.shift())) {
                this._pendingRead = false;
                if (!this._write._chunks.length && this._done) {
                    this._write = undefined;
                    this.push(null);
                }
                return;
            }
        }
        if (this._done) {
            this._write = undefined;
            this.push(null);
        }
    }
}

module.exports = {
    BufferReadStream: BufferReadStream
};
