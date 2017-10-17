/*global require,module*/

const ansi256 = require("ansi-256-colors");
const util = require("util");

function Colorize()
{
    this._state = [];
    this._reset = true;
}

Colorize.ensure = function(that)
{
    if (!(that instanceof Colorize)) {
        that = new Colorize();
    }
    return that;
};

const colorize = {
    fg: function fg(r, g, b) {
        let that = Colorize.ensure(this);
        that._add(ansi256.fg.getRgb, r, g, b);
        return that;
    },
    bg: function bg(r, g, b) {
        let that = Colorize.ensure(this);
        that._add(ansi256.bg.getRgb, r, g, b);
        return that;
    },
    gfg: function gfg(g) {
        let that = Colorize.ensure(this);
        that._add(ansi256.fg.grayscale[g]);
        return that;
    },
    gbg: function gbg(g) {
        let that = Colorize.ensure(this);
        that._add(ansi256.bg.grayscale[g]);
        return that;
    },
    noreset: function noreset() {
        let that = Colorize.ensure(this);
        that._reset = false;
        return that;
    },
    reset: function reset() {
        let that = Colorize.ensure(this);
        that._reset = true;
        return that;
    },
    log: function log(...args) {
        let that = Colorize.ensure(this);
        that.apply(console.log, ...args);
    },
    error: function error(...args) {
        let that = Colorize.ensure(this);
        that.apply(console.error, ...args);
    },
    format: function format(...args) {
        let that = Colorize.ensure(this);
        let str = "";
        that.apply(s => str = s, ...args);
        return str;
    },
    next: function(...args) {
        let that = Colorize.ensure(this);
        that.apply(str => { that._state = [str]; }, ...args);
        return that;
    },
    apply: function apply(func, format, ...args) {
        let that = Colorize.ensure(this);
        let str = "";
        for (let i = 0; i < that._state.length; ++i) {
            let state = that._state[i];
            if (state instanceof Array)
                str += "\u0001" + state[0](...state[1]) + "\u0002";
            else
                str += state;
        }
        str += util.format(format, ...args);
        that._state = [];
        func(str + (that._reset ? ("\u0001" + ansi256.reset + "\u0002") : ""));
        that._reset = true;
        return that;
    },
    _add: function _add(a, ...args) {
        if (a instanceof Function)
            this._state.push([a, args]);
        else
            this._state.push(a);
    }
};

Colorize.prototype = colorize;

module.exports = colorize;
