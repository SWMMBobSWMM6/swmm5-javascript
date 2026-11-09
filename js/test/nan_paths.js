// nan_paths.js - does strtod("-nan") keep its sign bit once V8 has optimised the code? It should: glibc returns
// 0xfff8000000000000. The TypeScript port's runtime (ts/dist/crt.js) returned the double through a JavaScript
// array, and after 100,000 warm-up calls V8's optimised code hands back the canonical NaN, 0x7ff8000000000000;
// the JavaScript runtime passes the value through a Float64Array instead. Columns: three cold calls, then one
// after warming up.   node js/test/nan_paths.js
// Written by Claude (Anthropic) for Robert Dickinson; see js/README.md.
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const mods = [["ts/dist/crt.js", require(path.join(ROOT, "ts/dist/crt.js"))], ["js/swmm5/crt.js", require(path.join(ROOT, "js/swmm5/crt.js"))]];
const D = new Float64Array(1), U = new BigUint64Array(D.buffer);
const bits = (x) => { D[0] = x; return U[0].toString(16).padStart(16, "0"); };
console.log("glibc strtod(\"-nan\") = fff8000000000000; node " + process.version);
for (const [name, M] of mods) {
  const s = M.lit("-nan");
  const out = [];
  for (let k = 0; k < 3; k++) out.push(bits(M.strtod(s, null)));
  for (let k = 0; k < 100000; k++) M.strtod(M.lit("1.5"), null);
  out.push(bits(M.strtod(s, null)));
  console.log(name.padEnd(16), out.join(" "));
}
