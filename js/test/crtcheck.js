// crtcheck.js - compare the JavaScript port's printf, strtod and sscanf (swmm5/crt.js) with the system glibc's
// results written by tools/crt/test/mkfmt.c (lines KIND \t FORMAT \t ARG \t RESULT, hex-encoded).
//   js/test/run_crtcheck.sh  (builds mkfmt, runs it and this script, prints the summary)
// Written by Claude (Anthropic) for Robert Dickinson; see js/README.md.
"use strict";
const fs = require("fs");
const C = require("../swmm5/crt");

const unhex = (s) => Buffer.from(s, "hex");
const hexs = (b) => Buffer.from(b).toString("hex");
const D = new Float64Array(1), DU = new BigUint64Array(D.buffer);
const dbl = (h) => { DU[0] = BigInt("0x" + h); return D[0]; };
const bits = (x) => { D[0] = x; return DU[0].toString(16).padStart(16, "0"); };
const cstr = (bytes) => { const b = new Uint8Array(bytes.length + 1); b.set(bytes, 0); return new C.CPtr(b, 0); };

const names = ["printf %f", "printf %d", "printf %ld", "printf %s", "strtod", "sscanf"];
const total = [0, 0, 0, 0, 0, 0], bad = [0, 0, 0, 0, 0, 0];
let shown = 0, skipped = 0;
const out = C.buf(1024);
const fcache = new Map();
const lines = fs.readFileSync(process.argv[2], "latin1").split("\n");
for (const line of lines) {
  if (line === "") continue;
  const [kind, fm, arg, want] = line.split("\t");
  let f = fcache.get(fm);
  if (f === undefined) { f = C.lit(fm); fcache.set(fm, f); }
  let k, got;
  if (kind === "f") {
    k = 0;
    const x = dbl(arg);
    if (fm === "%*.*f") C.snprintf(out, 1024, f, 9, 3, x); else C.snprintf(out, 1024, f, x);
    got = hexs(C.bytesOf(out));
  } else if (kind === "i") {
    k = 1;
    const v = parseInt(arg, 16) | 0;
    C.snprintf(out, 1024, f, v);
    got = hexs(C.bytesOf(out));
  } else if (kind === "l") {
    k = 2;
    const v = Number(BigInt.asIntN(64, BigInt("0x" + arg)));   // SWMM's longs stay below 2^53
    if (!Number.isSafeInteger(v)) { skipped++; continue; }       // not representable in the port's long model
    C.snprintf(out, 1024, f, v);
    got = hexs(C.bytesOf(out));
  } else if (kind === "s") {
    k = 3;
    C.snprintf(out, 1024, f, cstr(unhex(arg)));
    got = hexs(C.bytesOf(out));
  } else if (kind === "d") {
    k = 4;
    const s = cstr(unhex(arg));
    const e = new C.Box(null);
    const v = C.strtod(s, e);
    got = bits(v) + ":" + (e.v.o - s.o);
  } else if (kind === "n") {
    k = 5;
    const s = cstr(unhex(arg));
    const i1 = new C.Box(-77), d1 = new C.Box(-77.0);
    const b = C.buf(32); b.s(0, 63);
    const n = C.sscanf(s, C.lit("%d %lf %s"), ["i", i1], ["d", d1], b);
    got = n + ":" + i1.v + ":" + bits(d1.v) + ":" + hexs(C.bytesOf(b));
  } else continue;
  total[k]++;
  if (got === want) continue;
  bad[k]++;
  if (shown < 25) { shown++; console.error(`  ${kind} ${fm} arg=${arg}  glibc=${want}  js=${got}`); }
}
let tb = 0, tt = 0;
for (let k = 0; k < 6; k++) { console.log(`${names[k]}: ${total[k]} cases, ${bad[k]} differ`); tb += bad[k]; tt += total[k]; }
console.log(`${tb} of ${tt} cases differ (${skipped} %ld cases skipped: values beyond 2^53, which the port's long, a JavaScript number, does not hold)`);
