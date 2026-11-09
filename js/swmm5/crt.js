// crt.js - C runtime layer for the JavaScript port of EPA SWMM 5.2.4 (Node.js).
//
// Reproduces the glibc and x86-64 behaviour SWMM's output depends on: printf formatting with glibc's
// rounding (round half to even on the exact binary value), strtod/sscanf parsing (decimal, hexadecimal,
// inf, nan and nan(payload), as glibc reads them), NUL-terminated byte strings, stdio files with C's
// positioning and end-of-file rules, and x86's float-to-integer conversion. The math functions are in
// glibm.js (glibc 2.39's FMA routines translated by tools/libm/gim2x.py).
// Started from the TypeScript port's runtime (ts/src/crt.ts) with the types removed; strtod's hexadecimal
// floats and NaN payloads are new. Written by Claude (Anthropic) for Robert Dickinson; see js/README.md.
"use strict";
const fs = require("fs");
const path = require("path");

// ------------------------------------------------------------------ char* : bytes plus an offset
class CPtr {
  constructor(b, o) { this.b = b; this.o = o; }
  g(i) { return (this.b[this.o + i] << 24) >> 24; }      // signed char, as x86 C
  s(i, v) { this.b[this.o + i] = v; return v; }
  add(n) { return new CPtr(this.b, this.o + n); }
}

function lit(s) {
  const b = new Uint8Array(s.length + 1);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new CPtr(b, 0);
}
function buf(n) { return new CPtr(new Uint8Array(Math.max(n, 1)), 0); }
function bufFrom(src, n) {
  const p = buf(n);
  const m = Math.min(strlen(src), n);
  p.b.set(src.b.subarray(src.o, src.o + m), 0);
  return p;
}
function bufOf(n, vals) {
  const p = buf(n);
  for (let i = 0; i < vals.length; i++) p.b[i] = vals[i];
  return p;
}
function bufs(n, m) { return Array.from({ length: n }, () => buf(m)); }
function copyBuf(p) { return new CPtr(p.b.slice(), p.o); }
function reallocBuf(p, n) {
  const q = buf(n);
  if (p !== null) q.b.set(p.b.subarray(p.o, p.o + Math.min(n, p.b.length - p.o)), 0);
  return q;
}
function peq(a, b) {
  return a === b || (a !== null && b !== null && a.b === b.b && a.o === b.o);
}
function bytesOf(p) {
  let e = p.o;
  const b = p.b;
  while (e < b.length && b[e] !== 0) e++;
  return b.subarray(p.o, e);
}
function strOf(p) {
  const s = bytesOf(p);
  let r = "";
  for (let i = 0; i < s.length; i++) r += String.fromCharCode(s[i]);
  return r;
}

// ------------------------------------------------------------------ references (C's T* to one object)
class Box {
  constructor(v) { this.v = v; }
}
class ElemRef {
  constructor(a, i) { this.a = a; this.i = i; }
  get v() { return this.a[this.i]; }
  set v(x) { this.a[this.i] = x; }
}
class FieldRef {
  constructor(o, k) { this.o = o; this.k = k; }
  get v() { return this.o[this.k]; }
  set v(x) { this.o[this.k] = x; }
}
class CharRef {
  constructor(p, i) { this.p = p; this.i = i; }
  get v() { return this.p.g(this.i); }
  set v(x) { this.p.s(this.i, x); }
}
function acc(get, set) {
  return { get v() { return get(); }, set v(t) { set(t); } };
}

// ------------------------------------------------------------------ arithmetic with C semantics
function D2I(x) {        // (int)x on x86-64: NaN or out of range gives INT_MIN
  if (!(x > -2147483649 && x < 2147483648)) return -2147483648;
  return x | 0;
}
function D2L(x) {        // (long)x; a long is a JavaScript number (SWMM's stay < 2^53)
  if (!(x > -9223372036854775809 && x < 9223372036854775808)) return -9223372036854775808;
  return Math.trunc(x) + 0;
}
function toUL(x) { return x < 0 ? x + 18446744073709551616 : x; }
function postf(r, d) { const o = r.v; r.v = Math.fround(o + d); return o; }
function postu(r, d) { const o = r.v; r.v = (o + d) >>> 0; return o; }
function arr1(r, T, f) {
  const a = new T(1); a[0] = r.v;
  const res = f(a);
  r.v = a[0];
  return res;
}
function chr1(r, f) {
  const p = buf(2); p.s(0, r.v);
  const res = f(p);
  r.v = p.g(0);
  return res;
}

// ------------------------------------------------------------------ memory
function recs(n, mk) { return Array.from({ length: n }, mk); }
function nulls(n) { return new Array(n).fill(null); }
function grid(n, mk) { return Array.from({ length: n }, mk); }
function cloneGrid(g) { return g.map((x) => (x instanceof CPtr ? copyBuf(x) : x.slice())); }
function reallocArr(a, n, mk) {
  if (a === null) return Array.from({ length: n }, mk);
  if (n <= a.length) return a.slice(0, n);
  const r = a.slice();
  while (r.length < n) r.push(mk());
  return r;
}
function reallocTyped(a, n, T) {
  const r = new T(n);
  if (a !== null) r.set(a.subarray(0, Math.min(n, a.length)), 0);
  return r;
}
function memset(a, v, n) {
  if (a instanceof CPtr) { a.b.fill(v & 255, a.o, a.o + n); return; }
  a.fill(0, 0, Math.min(a.length, Math.trunc(n / a.BYTES_PER_ELEMENT)));
}

// ------------------------------------------------------------------ strings
function strlen(p) {
  const b = p.b; let e = p.o;
  while (b[e] !== 0) e++;
  return e - p.o;
}
function strcpy(d, s) {
  const n = strlen(s);
  if (d.b === s.b) d.b.copyWithin(d.o, s.o, s.o + n + 1);
  else d.b.set(s.b.subarray(s.o, s.o + n + 1), d.o);
  return d;
}
function strcat(d, s) { strcpy(d.add(strlen(d)), s); return d; }
function strcmp(a, b) {
  let i = a.o, j = b.o;
  const x = a.b, y = b.b;
  for (;;) {
    const c = x[i], d = y[j];
    if (c !== d) return c - d;
    if (c === 0) return 0;
    i++; j++;
  }
}
function strchr(s, c) {
  c &= 255;
  const b = s.b;
  for (let i = s.o; ; i++) {
    if (b[i] === c) return new CPtr(b, i);
    if (b[i] === 0) return null;
  }
}
function strrchr(s, c) {
  c &= 255;
  const e = s.o + strlen(s);
  if (c === 0) return new CPtr(s.b, e);
  for (let i = e - 1; i >= s.o; i--) if (s.b[i] === c) return new CPtr(s.b, i);
  return null;
}
function strstr(h, n) {
  const hb = bytesOf(h), nb = bytesOf(n);
  outer: for (let i = 0; i + nb.length <= hb.length; i++) {
    for (let k = 0; k < nb.length; k++) if (hb[i + k] !== nb[k]) continue outer;
    return new CPtr(h.b, h.o + i);
  }
  return null;
}
function strcspn(s, rej) {
  const sb = bytesOf(s), rb = bytesOf(rej);
  for (let i = 0; i < sb.length; i++) if (rb.indexOf(sb[i]) >= 0) return i;
  return sb.length;
}
let tokNext = null;
function strtok(s, delim) {
  if (s !== null) tokNext = s;
  const p = tokNext;
  if (p === null) return null;
  const ds = bytesOf(delim);
  const b = p.b;
  let i = p.o;
  while (b[i] !== 0 && ds.indexOf(b[i]) >= 0) i++;
  if (b[i] === 0) { tokNext = null; return null; }
  const start = i;
  while (b[i] !== 0 && ds.indexOf(b[i]) < 0) i++;
  if (b[i] !== 0) { b[i] = 0; tokNext = new CPtr(b, i + 1); }
  else tokNext = null;
  return new CPtr(b, start);
}
function toupper(c) { return c >= 97 && c <= 122 ? c - 32 : c; }

function isSpace(c) { return c === 32 || (c >= 9 && c <= 13); }
function low(c) { return c >= 65 && c <= 90 ? c | 0x20 : c; }
function hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  const l = low(c);
  return l >= 97 && l <= 102 ? l - 87 : -1;
}
const NB = new Float64Array(1), NBU = new BigUint64Array(NB.buffer);
function fromBits(u) { NBU[0] = BigInt.asUintN(64, u); return NB[0]; }
const DEFAULT_NAN = fromBits(0xfff8000000000000n);     // x86's NaN, sign bit set: glibc prints "-nan"
const POS_NAN = fromBits(0x7ff8000000000000n);         // glibc's NAN

// the double nearest to m * 2^e (m >= 0 a BigInt), ties to even, with subnormals and overflow as IEEE
function roundBinary(m, e) {
  if (m === 0n) return 0;
  const n = m.toString(2).length;
  const top = n - 1 + e;                               // exponent of the leading bit
  if (top > 1023) return Infinity;
  const shift = top >= -1022 ? n - 53 : -1074 - e;     // drop this many low bits
  let q = m, k = e;
  if (shift > 0) {
    const sh = BigInt(shift);
    q = m >> sh;
    const rem = m & ((1n << sh) - 1n), half = 1n << (sh - 1n);
    if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
    k = e + shift;
  }
  if (q === 0n) return 0;
  const qb = q.toString(2).length;
  if (k + qb - 1 > 1023) return Infinity;
  // q < 2^54 converts exactly; scale by 2^k in two exact steps
  let v = Number(q);
  if (k >= -1022) v *= pow2(k);
  else { v *= pow2(k + 600); v *= pow2(-600); }
  return v;
}
function pow2(k) {           // 2^k for -1074 <= k <= 1023
  if (k >= -1022) return fromBits(BigInt(k + 1023) << 52n);
  return fromBits(1n << BigInt(k + 1074));
}

// parse a C floating-point number at b[i..] (at most maxw characters): returns the end, or -1 if there is no
// number, and leaves the value in SV[0]. The value is not returned in an array: V8's optimised code may turn a
// NaN stored in a JavaScript array into its canonical NaN, sign bit clear, so "-nan" read by strtod in hot code
// came back as "nan" (js/test/nan_paths.js); a Float64Array keeps the bits.
const SV = new Float64Array(1);
function scanDouble(b, i, maxw, skipSpace) {
  SV[0] = 0;
  const n = b.length;
  if (skipSpace) while (i < n && isSpace(b[i])) i++;
  const lim = maxw < 0 ? n : i + maxw;
  const g = (k) => (k < lim && k < n ? b[k] : 0);
  let neg = false;
  if (g(i) === 43 || g(i) === 45) { neg = g(i) === 45; i++; }
  if (low(g(i)) === 105 && low(g(i + 1)) === 110 && low(g(i + 2)) === 102) {
    i += 3;
    if (low(g(i)) === 105 && low(g(i + 1)) === 110 && low(g(i + 2)) === 105 && low(g(i + 3)) === 116 && low(g(i + 4)) === 121) i += 5;
    SV[0] = neg ? -Infinity : Infinity;
    return i;
  }
  if (low(g(i)) === 110 && low(g(i + 1)) === 97 && low(g(i + 2)) === 110) {
    i += 3;
    let bits = 0x7ff8000000000000n;
    if (g(i) === 40) {                                   // nan(n-char-sequence): glibc's strtod_nan
      let k = i + 1;
      while ((g(k) >= 48 && g(k) <= 57) || (low(g(k)) >= 97 && low(g(k)) <= 122) || g(k) === 95) k++;
      if (g(k) === 41) {
        const p = strtoullBase0(b, i + 1, k);            // the payload if the whole sequence is one number
        if (p !== null) bits |= p & 0x7ffffffffffffn;
        i = k + 1;
      }
    }
    if (neg) bits |= 0x8000000000000000n;
    NBU[0] = bits;
    SV[0] = NB[0];
    return i;
  }
  if (g(i) === 48 && low(g(i + 1)) === 120) {           // hexadecimal: 0x h.hhh p+-d
    let k = i + 2, m = 0n, nd = 0, e = 0, seenDot = false;
    for (;; k++) {
      const c = g(k);
      if (c === 46 && !seenDot) { seenDot = true; continue; }
      const h = hexVal(c);
      if (h < 0) break;
      m = (m << 4n) | BigInt(h); nd++;
      if (seenDot) e -= 4;
    }
    if (nd === 0) { SV[0] = neg ? -0 : 0; return i + 1; }   // "0x" alone: the "0" is the number
    if (low(g(k)) === 112) {
      let j = k + 1, eneg = false;
      if (g(j) === 43 || g(j) === 45) { eneg = g(j) === 45; j++; }
      if (g(j) >= 48 && g(j) <= 57) {
        let x = 0;
        while (g(j) >= 48 && g(j) <= 57) { if (x < 100000) x = x * 10 + g(j) - 48; j++; }
        e += eneg ? -x : x;
        k = j;
      }
    }
    const v = roundBinary(m, e);
    SV[0] = neg ? -v : v;
    return k;
  }
  const ms = i;
  let nd = 0;
  while (g(i) >= 48 && g(i) <= 57) { i++; nd++; }
  if (g(i) === 46) { i++; while (g(i) >= 48 && g(i) <= 57) { i++; nd++; } }
  if (nd === 0) return -1;
  if (low(g(i)) === 101) {
    let k = i + 1;
    if (g(k) === 43 || g(k) === 45) k++;
    if (g(k) >= 48 && g(k) <= 57) { while (g(k) >= 48 && g(k) <= 57) k++; i = k; }
  }
  let s = "";
  for (let k = ms; k < i; k++) s += String.fromCharCode(b[k]);
  const v = Number(s);                    // correctly rounded, as glibc's strtod
  SV[0] = neg ? -v : v;
  return i;
}
// strtoull(b[i..e), &end, 0) when it consumes exactly [i, e); null otherwise
function strtoullBase0(b, i, e) {
  let base = 10, k = i;
  if (k < e && b[k] === 48) {
    if (k + 1 < e && low(b[k + 1]) === 120 && k + 2 < e && hexVal(b[k + 2]) >= 0) { base = 16; k += 2; }
    else base = 8;
  }
  if (k === e) return k === i ? (e === i ? 0n : null) : 0n;
  let v = 0n, over = false;
  for (; k < e; k++) {
    const h = hexVal(b[k]);
    if (h < 0 || h >= base) return null;
    v = v * BigInt(base) + BigInt(h);
    if (v > 0xffffffffffffffffn) over = true;
  }
  return over ? 0xffffffffffffffffn : v;
}
function strtod(s, end) {
  const e = scanDouble(s.b, s.o, -1, true);
  if (end !== null) end.v = e < 0 ? s : new CPtr(s.b, e);
  return e < 0 ? 0 : SV[0];
}
function atof(s) { return strtod(s, null); }
function atoi(s) {
  const b = s.b;
  let i = s.o;
  while (b[i] !== 0 && isSpace(b[i])) i++;
  let neg = false;
  if (b[i] === 43 || b[i] === 45) { neg = b[i] === 45; i++; }
  const ds = i;
  while (b[i] >= 48 && b[i] <= 57) i++;
  return Number(BigInt.asIntN(32, strtolDigits(b, ds, i, neg)));   // strtol's long, then (int): the low 32 bits
}
// the long value of the decimal digits b[ds..de) with sign, saturated as strtol saturates (a BigInt)
const LONG_MAX = 0x7fffffffffffffffn, LONG_MIN = -0x8000000000000000n;
function strtolDigits(b, ds, de, neg) {
  let v;
  if (de - ds <= 15) {
    let x = 0;
    for (let k = ds; k < de; k++) x = x * 10 + b[k] - 48;
    v = BigInt(x);
  } else {
    let t = "";
    for (let k = ds; k < de; k++) t += String.fromCharCode(b[k]);
    v = BigInt(t);
  }
  if (neg) v = -v;
  return v > LONG_MAX ? LONG_MAX : v < LONG_MIN ? LONG_MIN : v;
}

// ------------------------------------------------------------------ sscanf
// arguments: [tag, ref] pairs for numbers ('i' int, 'l' long, 'd' double, 'f' float), CPtr for %s and %c
function sscanf(s, fmt, ...args) {
  const b = s.b;
  let i = s.o;
  const f = bytesOf(fmt);
  let k = 0, ai = 0, count = 0, anyInput = false;
  const n = b.length, nf = f.length;
  const ch = (j) => (j < n ? b[j] : 0);
  while (k < nf) {
    const fc = f[k];
    if (isSpace(fc)) {
      while (k < nf && isSpace(f[k])) k++;
      while (ch(i) !== 0 && isSpace(ch(i))) i++;
      continue;
    }
    if (fc !== 37) {
      if (ch(i) === 0) return anyInput || count > 0 ? count : -1;
      if (ch(i) !== fc) return count;
      i++; k++;
      continue;
    }
    k++;
    if (f[k] === 37) {
      while (ch(i) !== 0 && isSpace(ch(i))) i++;
      if (ch(i) !== 37) return count;
      i++; k++;
      continue;
    }
    let suppress = false;
    if (f[k] === 42) { suppress = true; k++; }
    let width = 0;
    while (f[k] >= 48 && f[k] <= 57) { width = width * 10 + f[k] - 48; k++; }
    let lmod = 0;
    while (f[k] === 108 || f[k] === 104 || f[k] === 76) { if (f[k] === 108) lmod++; k++; }
    const conv = f[k];
    k++;
    if (conv !== 99 && conv !== 91 && conv !== 110) while (ch(i) !== 0 && isSpace(ch(i))) i++;
    if (ch(i) === 0 && conv !== 110) return count === 0 && !anyInput ? -1 : count;
    if (conv === 100 || conv === 105 || conv === 117) {            // d i u
      let j = i;
      const lim = width ? i + width : n;
      let neg = false;
      if (j < lim && (ch(j) === 43 || ch(j) === 45)) { neg = ch(j) === 45; j++; }
      const ds = j;
      while (j < lim && ch(j) >= 48 && ch(j) <= 57) j++;
      if (j === ds) return count;
      const v = strtolDigits(b, ds, j, neg);                       // strtol's saturated long
      i = j;
      anyInput = true;
      if (!suppress) {
        const a = args[ai++];
        a[1].v = lmod > 0 || a[0] === "l" ? Number(v) : Number(BigInt.asIntN(32, v));
        count++;
      }
    } else if (conv === 102 || conv === 101 || conv === 103) {      // f e g
      const e = scanDouble(b, i, width ? width : -1, false);
      if (e < 0) return count;
      i = e;
      anyInput = true;
      if (!suppress) {
        const a = args[ai++];
        a[1].v = lmod > 0 || a[0] === "d" ? SV[0] : Math.fround(SV[0]);
        count++;
      }
    } else if (conv === 115) {                                       // s
      let j = i;
      const w = width ? width : 1 << 30;
      let m = 0;
      while (ch(j) !== 0 && !isSpace(ch(j)) && m < w) { j++; m++; }
      if (!suppress) {
        const d = args[ai++];
        d.b.set(b.subarray(i, j), d.o);
        d.b[d.o + m] = 0;
        count++;
      }
      i = j;
      anyInput = true;
    } else if (conv === 99) {                                        // c
      const cnt = width ? width : 1;
      if (ch(i) === 0) return count === 0 && !anyInput ? -1 : count;
      const a = suppress ? null : args[ai++];
      let t = 0;
      while (t < cnt && ch(i) !== 0) {
        if (!suppress) {
          if (a instanceof CPtr) a.b[a.o + t] = ch(i);
          else { const c = ch(i); a[1].v = c > 127 ? c - 256 : c; }
        }
        i++; t++;
      }
      anyInput = true;
      if (!suppress) count++;
    } else {
      throw new Error("sscanf %" + String.fromCharCode(conv));
    }
  }
  return count;
}

// ------------------------------------------------------------------ printf
const P2 = new Float64Array(64);
for (let k = 0; k < 64; k++) P2[k] = 2 ** k;

function decompose(a) {         // a = m * 2^e, a finite and >= 0
  const f = new Float64Array([a]);
  const u = new Uint32Array(f.buffer);
  const hi = u[1], lo = u[0];
  const ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (ex === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, ex - 1075];
}
function scaledRound(a, p) {      // round_half_even(a * 10^p), exactly
  const [m, e] = decompose(a);
  let num = m, den = 1n;
  if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
  if (p >= 0) num *= 10n ** BigInt(p); else den *= 10n ** BigInt(-p);
  let q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q;
}
function fixedDigits(a, prec, alt) {
  let s;
  if (a < 1e21 && prec <= 100) {
    s = a.toFixed(prec);                                  // exact, but rounds ties away from zero
    if (prec + 1 < 64) {
      const t = a * P2[prec + 1];                         // a tie iff a * 2^(prec+1) is an odd integer
      if (Number.isInteger(t) && t % 2 === 1) {
        const last = s.charCodeAt(s.length - 1) - 48;
        if (last % 2 === 1) s = s.slice(0, -1) + String.fromCharCode(48 + last - 1);
      }
    }
  } else {
    const d = scaledRound(a, prec).toString();
    s = prec === 0 ? d : (d.length <= prec ? "0".repeat(prec - d.length + 1) + d : d);
    if (prec > 0) s = s.slice(0, s.length - prec) + "." + s.slice(s.length - prec);
  }
  if (prec === 0 && alt) s += ".";
  return s;
}
function expDigitsRaw(a, prec) {
  if (a === 0) return ["0".repeat(prec + 1), 0];
  let E = Math.floor(Math.log10(a));
  for (let iter = 0; iter < 4; iter++) {
    const d = scaledRound(a, prec - E).toString();
    if (d.length === prec + 1) return [d, E];
    if (d.length > prec + 1) E++; else E--;
  }
  return [scaledRound(a, prec - E).toString(), E];
}
function expDigits(a, prec, alt, upper) {
  const [d, X] = expDigitsRaw(a, prec);
  const mant = d.slice(0, 1) + (prec > 0 ? "." + d.slice(1) : alt ? "." : "");
  const ax = Math.abs(X);
  return mant + (upper ? "E" : "e") + (X < 0 ? "-" : "+") + (ax < 10 ? "0" + ax : String(ax));
}
function formatFloat(a, conv, prec, alt) {
  const lc = conv | 0x20;
  if (lc === 102) return fixedDigits(a, prec, alt);
  if (lc === 101) return expDigits(a, prec, alt, conv === 69);
  const P = prec === 0 ? 1 : prec;
  const X = a === 0 ? 0 : expDigitsRaw(a, P - 1)[1];
  let s = P > X && X >= -4 ? fixedDigits(a, P - 1 - X, alt) : expDigits(a, P - 1, alt, conv === 71);
  if (!alt) {
    const ep = s.search(/[eE]/);
    let mant = ep >= 0 ? s.slice(0, ep) : s;
    const ex = ep >= 0 ? s.slice(ep) : "";
    if (mant.indexOf(".") >= 0) { mant = mant.replace(/0+$/, ""); if (mant.endsWith(".")) mant = mant.slice(0, -1); }
    s = mant + ex;
  }
  return s;
}
const F1 = new Float64Array(1), U1 = new Uint32Array(F1.buffer);
function signBit(x) { F1[0] = x; return (U1[1] >>> 31) === 1; }

// the formatted bytes as a latin-1 string (one char per byte)
function format(fmt, args) {
  const f = fmt.b;
  let k = fmt.o, ai = 0;
  let o = "";
  while (f[k] !== 0) {
    if (f[k] !== 37) {
      let e = k;
      while (f[e] !== 0 && f[e] !== 37) e++;
      for (let q = k; q < e; q++) o += String.fromCharCode(f[q]);
      k = e;
      continue;
    }
    k++;
    if (f[k] === 37) { o += "%"; k++; continue; }
    let left = false, plus = false, space = false, alt = false, zero = false;
    for (;; k++) {
      const c = f[k];
      if (c === 45) left = true;
      else if (c === 43) plus = true;
      else if (c === 32) space = true;
      else if (c === 35) alt = true;
      else if (c === 48) zero = true;
      else break;
    }
    let width = 0, prec = -1;
    if (f[k] === 42) { width = args[ai++]; if (width < 0) { left = true; width = -width; } k++; }
    else while (f[k] >= 48 && f[k] <= 57) { width = width * 10 + f[k] - 48; k++; }
    if (f[k] === 46) {
      k++; prec = 0;
      if (f[k] === 42) { prec = args[ai++]; if (prec < 0) prec = -1; k++; }
      else while (f[k] >= 48 && f[k] <= 57) { prec = prec * 10 + f[k] - 48; k++; }
    }
    let lmod = false;
    while (f[k] === 108 || f[k] === 104 || f[k] === 76 || f[k] === 122 || f[k] === 106 || f[k] === 116 || f[k] === 113) { if (f[k] === 108) lmod = true; k++; }
    const conv = f[k];
    k++;
    let body, sign = "", numeric = true;
    switch (conv) {
      case 100: case 105: {                                   // d i
        const v = Math.trunc(args[ai++]);
        if (v < 0) sign = "-"; else if (plus) sign = "+"; else if (space) sign = " ";
        body = String(Math.abs(v));
        if (prec >= 0) { zero = false; if (prec === 0 && v === 0) body = ""; body = body.padStart(prec, "0"); }
        break;
      }
      case 117: case 120: case 88: case 111: {                // u x X o
        let v = Math.trunc(args[ai++]);
        let bv = null;                                        // a negative long read as unsigned 64-bit (BigInt)
        if (v < 0) { if (lmod) bv = BigInt(v) + 18446744073709551616n; else v = (v | 0) + 4294967296; }
        const base = conv === 117 ? 10 : conv === 111 ? 8 : 16;
        body = bv !== null ? bv.toString(base) : v.toString(base);
        if (conv === 88) body = body.toUpperCase();
        if (prec >= 0) { zero = false; if (prec === 0 && v === 0) body = ""; body = body.padStart(prec, "0"); }
        break;
      }
      case 99: {                                              // c
        numeric = false;
        body = String.fromCharCode(args[ai++] & 255);
        break;
      }
      case 115: {                                             // s
        numeric = false;
        const p = args[ai++];
        let s = p === null ? "(null)" : strOf(p);
        if (prec >= 0 && s.length > prec) s = s.slice(0, prec);
        body = s;
        break;
      }
      case 102: case 70: case 101: case 69: case 103: case 71: {
        const v = args[ai++];
        if (prec < 0) prec = 6;
        if (signBit(v)) sign = "-"; else if (plus) sign = "+"; else if (space) sign = " ";
        if (v !== v || v === Infinity || v === -Infinity) {
          body = v !== v ? "nan" : "inf";
          if (conv === 70 || conv === 69 || conv === 71) body = body.toUpperCase();
          zero = false;
        } else body = formatFloat(Math.abs(v), conv, prec, alt);
        break;
      }
      default:
        throw new Error("printf %" + String.fromCharCode(conv));
    }
    const len = sign.length + body.length;
    if (len >= width) o += sign + body;
    else if (left) o += sign + body + " ".repeat(width - len);
    else if (zero && numeric) o += sign + "0".repeat(width - len) + body;
    else o += " ".repeat(width - len) + sign + body;
  }
  return o;
}
function fprintf(f, fmt, ...args) {
  const s = format(fmt, args);
  if (f === null) return -1;
  f.writeStr(s);
  return s.length;
}
function snprintf(b, n, fmt, ...args) {
  const s = format(fmt, args);
  if (n > 0) {
    const m = Math.min(s.length, n - 1);
    for (let i = 0; i < m; i++) b.b[b.o + i] = s.charCodeAt(i);
    b.b[b.o + m] = 0;
  }
  return s.length;
}

// ------------------------------------------------------------------ files
const BUFSZ = 1 << 16;
class CFile {
  constructor(fd, std) {
    this.fd = fd; this.std = std;
    this.pos = 0;
    this.eof = false;
    this.wbuf = null; this.wlen = 0; this.wpos = 0;             // pending writes, starting at file offset wpos
    this.rbuf = null; this.rstart = 0; this.rlen = 0;           // cached bytes of the file at [rstart, rstart + rlen)
  }
  flush() {
    if (this.wlen > 0) {
      let off = 0;
      while (off < this.wlen) off += fs.writeSync(this.fd, this.wbuf, off, this.wlen - off, this.std ? null : this.wpos + off);
      this.wlen = 0;
    }
  }
  write(src, off, n) {
    this.rlen = 0;
    if (this.wbuf === null) this.wbuf = new Uint8Array(BUFSZ);
    if (this.wlen > 0 && this.pos !== this.wpos + this.wlen) this.flush();
    if (this.wlen === 0) this.wpos = this.pos;
    if (this.wlen + n > BUFSZ) {
      this.flush();
      if (n > BUFSZ) {
        let w = 0;
        while (w < n) w += fs.writeSync(this.fd, src, off + w, n - w, this.std ? null : this.pos + w);
        this.pos += n;
        return;
      }
      this.wpos = this.pos;
    }
    this.wbuf.set(src.subarray(off, off + n), this.wlen);
    this.wlen += n;
    this.pos += n;
  }
  writeStr(s) {
    const n = s.length;
    const t = n <= tmpStr.length ? tmpStr : new Uint8Array(n);
    for (let i = 0; i < n; i++) t[i] = s.charCodeAt(i);
    this.write(t, 0, n);
  }
  // read up to n bytes at the current position; the count read
  read(dst, off, n) {
    this.flush();
    let got = 0;
    while (got < n) {
      if (this.rlen > 0 && this.pos >= this.rstart && this.pos < this.rstart + this.rlen) {
        const a = this.pos - this.rstart;
        const m = Math.min(n - got, this.rlen - a);
        dst.set(this.rbuf.subarray(a, a + m), off + got);
        got += m; this.pos += m;
        continue;
      }
      if (this.rbuf === null) this.rbuf = new Uint8Array(BUFSZ);
      this.rstart = this.pos;
      this.rlen = fs.readSync(this.fd, this.rbuf, 0, BUFSZ, this.pos);
      if (this.rlen === 0) break;
    }
    return got;
  }
  // next byte or -1 at end of file
  getc() {
    if (this.rlen > 0 && this.pos >= this.rstart && this.pos < this.rstart + this.rlen && this.wlen === 0) {
      return this.rbuf[this.pos++ - this.rstart];
    }
    const n = this.read(tmp1, 0, 1);
    return n === 1 ? tmp1[0] : -1;
  }
  size() { this.flush(); return fs.fstatSync(this.fd).size; }
}
const tmp1 = new Uint8Array(1);
const tmpStr = new Uint8Array(4096);
const stdout = new CFile(1, true);

function fopen(name, mode) {
  const fn = strOf(name);
  const m = strOf(mode).replace(/[tb]/g, "");
  try {
    const fd = fs.openSync(fn, m);
    const f = new CFile(fd, false);
    if (m[0] === "a") f.pos = f.size();
    return f;
  } catch (e) {
    return null;
  }
}
function fclose(f) {
  if (f === null) return -1;
  f.flush();
  if (!f.std) fs.closeSync(f.fd);
  return 0;
}
function fflush(f) { if (f !== null) f.flush(); return 0; }
function feof(f) { return f.eof ? 1 : 0; }
function rewind(f) { f.flush(); f.pos = 0; f.eof = false; }
function fseek(f, off, whence) {
  f.flush();
  const p = whence === 0 ? off : whence === 1 ? f.pos + off : f.size() + off;
  if (p < 0) return -1;
  f.pos = p;
  f.eof = false;
  return 0;
}
function ftell(f) { return f.pos; }
function fgets(b, n, f) {
  let m = 0;
  while (m < n - 1) {
    const c = f.getc();
    if (c < 0) { f.eof = true; break; }
    b.b[b.o + m++] = c;
    if (c === 10) break;
  }
  if (m === 0) return null;
  b.b[b.o + m] = 0;
  return b;
}
function remove(name) {
  try { fs.unlinkSync(strOf(name)); return 0; } catch (e) { return -1; }
}
function mkstemp(template) {
  const n = strlen(template);
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let tries = 0; tries < 1000; tries++) {
    for (let i = n - 6; i < n; i++) template.s(i, chars.charCodeAt(Math.floor(Math.random() * chars.length)));
    try {
      const fd = fs.openSync(strOf(template), "wx", 0o600);
      fs.closeSync(fd);
      return 3;
    } catch (e) {
      continue;
    }
  }
  return -1;
}
function realpathOf(p) {
  try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); }
}

// binary I/O of one value or an array; code: d double, f float, i int, I unsigned, q long, c char
const IO = new DataView(new ArrayBuffer(8));
const IOB = new Uint8Array(IO.buffer);
function packOne(code, v) {
  switch (code) {
    case "d": IO.setFloat64(0, v, true); return 8;
    case "f": IO.setFloat32(0, v, true); return 4;
    case "i": IO.setInt32(0, v, true); return 4;
    case "I": IO.setUint32(0, v >>> 0, true); return 4;
    case "q": IO.setBigInt64(0, BigInt(v), true); return 8;
    case "c": IO.setUint8(0, v & 255); return 1;
  }
  throw new Error("fwrite code " + code);
}
function unpackOne(code) {
  switch (code) {
    case "d": return IO.getFloat64(0, true);
    case "f": return IO.getFloat32(0, true);
    case "i": return IO.getInt32(0, true);
    case "I": return IO.getUint32(0, true);
    case "q": return Number(IO.getBigInt64(0, true));
    case "c": return (IO.getUint8(0) << 24) >> 24;
  }
  throw new Error("fread code " + code);
}
function fwrite1(code, size, v, f) {
  packOne(code, v);
  f.write(IOB, 0, size);                 // an 8-byte long written with sizeof(INT4): its low 4 bytes
  return 1;
}
function fread1(code, size, r, f) {
  packOne(code, Number.isFinite(r.v) ? r.v : 0);   // a short read keeps the upper bytes of the old value
  const got = f.read(IOB, 0, size);
  if (got < size) { f.eof = true; return 0; }
  r.v = unpackOne(code);
  return 1;
}
function fwrite_arr(code, size, a, off, n, f) {
  if (code === "c") { const p = a; f.write(p.b, p.o + off, n); return n; }
  for (let i = 0; i < n; i++) { const m = packOne(code, a[off + i]); f.write(IOB, 0, m); }
  return n;
}
function fread_arr(code, size, a, off, n, f) {
  if (code === "c") {
    const p = a;
    const got = f.read(p.b, p.o + off, n);
    if (got < n) f.eof = true;
    return got;
  }
  for (let i = 0; i < n; i++) {
    const m = packOne(code, 0);
    if (f.read(IOB, 0, m) < m) { f.eof = true; return i; }
    a[off + i] = unpackOne(code);
  }
  return n;
}

// ------------------------------------------------------------------ time
function time() { return Math.floor(Date.now() / 1000); }
function ctime(t) {
  const d = new Date(t * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p2 = (x) => (x < 10 ? "0" + x : String(x));
  const dd = d.getDate();
  return lit(days[d.getDay()] + " " + mons[d.getMonth()] + " " + (dd < 10 ? " " + dd : String(dd)) + " " +
    p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + " " + d.getFullYear() + "\n");
}

module.exports = {
  CPtr, lit, buf, bufFrom, bufOf, bufs, copyBuf, reallocBuf, peq, bytesOf, strOf,
  Box, ElemRef, FieldRef, CharRef, acc,
  D2I, D2L, toUL, postf, postu, arr1, chr1,
  recs, nulls, grid, cloneGrid, reallocArr, reallocTyped, memset,
  strlen, strcpy, strcat, strcmp, strchr, strrchr, strstr, strcspn, strtok, toupper,
  strtod, atof, atoi, sscanf, format, fprintf, snprintf,
  CFile, stdout, fopen, fclose, fflush, feof, rewind, fseek, ftell, fgets, remove, mkstemp, realpathOf,
  fwrite1, fread1, fwrite_arr, fread_arr, time, ctime,
};
