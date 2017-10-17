/*global require,process*/

"use strict";

const daemon = require("./lib/daemon");
const argv = require("minimist")(process.argv.slice(2));

daemon.send(process.cwd(), argv).then(ret => {
    console.log(ret);
    process.exit();
}).catch(e => {
    console.error(e);
    process.exit();
});
