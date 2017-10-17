/*global require,module*/

const player = {
    handle: function(data) {
        return new Promise((resolve, reject) => {
            resolve({ ok: true });
        });
    }
};

module.exports = player;
