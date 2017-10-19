/*global require,module*/

const util = require("util");

class Output
{
    constructor(template) {
        this._template = template;
        this._elements = [[]];
    }

    add(element) {
        this._ensureAuto();

        let cur = this._elements[this._elements.length - 1];
        if (cur.length == this._template._descriptions.length) {
            cur = [];
            this._elements.push(cur);
        }
        cur.push(element);
        return this;
    }

    override(description, element) {
        this.add({ description: description, element: element });
        return this;
    }

    end() {
        this._elements.push([]);
        return this;
    }

    format(theme) {
        this._ensureAuto();

        let out = "";
        for (let line = 0; line < this._elements.length; ++line) {
            let outline = "";
            let linelength = 0;
            const l = this._elements[line];
            for (let col = 0; col < l.length; ++col) {
                if (this._template._pads.has(col)) {
                    // pad our string up to the pad value
                    const to = this._template._pads.get(col);
                    for (let i = linelength; i < to; ++i) {
                        outline += " ";
                    }
                }

                let description;
                let element;
                const e = l[col];
                if (typeof e == "object" && "description" in e && "element" in e) {
                    description = e.description;
                    element = (typeof e.element === "string") ? e.element : util.format(e.element);
                } else {
                    description = this._template._descriptions[col];
                    element = (typeof e === "string") ? e : util.format(e);
                }
                const t = theme._styles.get(description);
                linelength += (element + "").length;
                if (t) {
                    outline += t(element);
                } else {
                    outline += element;
                }
            }
            out += outline + "\n";
        }
        return out.trim();
    }

    _ensureAuto() {
        const cur = this._elements[this._elements.length - 1];
        if (this._template._autos.has(cur.length)) {
            cur.push(this._template._autos.get(cur.length));
        }
    }
}

class OutputTemplate
{
    constructor() {
        this._descriptions = [];
        this._autos = new Map();
        this._pads = new Map();
        this._next = 0;
    }

    add(description) {
        this._descriptions.push(description);
        return this;
    }

    auto(description, value) {
        if (value !== undefined) {
            this._autos.set(this._descriptions.length, value);
        } else {
            this._autos.set(this._descriptions.length, description);
            description = this._generateDescription();
        }
        this._descriptions.push(description);
        return this;
    }

    pad(to) {
        this._pads.set(this._descriptions.length, to);
        return this;
    }

    new() {
        return new Output(this);
    }

    _generateDescription() {
        return `auto${++this._next}`;
    }
}

class OutputTheme
{
    constructor() {
        this._styles = new Map();
    }

    style(description, func) {
        this._styles.set(description, func);
        return this;
    }
}

module.exports = { Template: OutputTemplate, Theme: OutputTheme };
