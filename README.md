# swmm5-javascript

EPA SWMM 5.2.4 in plain JavaScript, written by a translator that reads EPA's C, and judged against EPA itself:
the binary `.out` file byte for byte, and the `.rpt` report line for line except the three lines that print the
wall clock.

**Result: 480 of 480 models identical** (`js/results/js_2a.json` to `js_2d.json`, the final runs, one per quarter of
the gate set; and the independent rerun from a clean regeneration, `js/results/js_va.json` to `js_vd.json`, gave 480 of 480 again). The 480 took 1,737 seconds of wall
time run one at a time (the sum of the per-model times the gate records, on a machine shared with other agents'
runs; the slowest, Hydrology/SCANLON.inp, took 194 s). No interleaved benchmark against EPA was run, so no speed
ratio is claimed.

It is not a new engine and not a wrapper: there is no C in it and it calls no other port. Every number it writes
is EPA 5.2.4's, including the results of EPA's own defects wherever EPA's behaviour is defined
(`lessons/02-epa-defects-found.md`). Node runs the files as they are: there is no TypeScript, no build step and
no dependency outside Node itself.

## How close it is to the TypeScript port

Very close, on purpose. The TypeScript port's translator already writes every expression and statement in a form
that is valid JavaScript; TypeScript only adds types to declarations. So:

- `tools/c2x/emit_js.py` (216 lines) subclasses the TypeScript back end (`emit_ts.py`) and replaces only the
  methods that write declarations: function signatures, the hoisted locals at the top of each function, record
  classes, module variables, and the module header (CommonJS `require` instead of `import`). Measured
  (`js/test/compare_with_ts.py`, `js/results/compare_with_ts.txt`): with each function's signature line and its
  hoisted-declaration line set aside, the 36,297 lines of function bodies in `js/swmm5/engine.js` are identical,
  line for line, to those of a freshly generated `engine.ts`.
- The math is the same translation of glibc's GIMPLE, written by a new JavaScript back end of
  `tools/libm/gim2x.py` (`JsEmitter`, `WRAPPERS_JS`): its expressions follow the TypeScript rules (BigInt for
  64-bit integers, `Math.imul`, `R.fma` for every fused multiply-add GCC placed), its declarations carry no types.
  The 4,896 lines of translated routines in `js/swmm5/glibm.js` are identical to those in `ts/src/glibm.ts`, and
  the 25 constant tables are identical. The JavaScript port does not import any TypeScript file.
- The hand-written runtime started from the TypeScript port's (`crt.ts`, `overrides.ts`, `glibm_rt.ts`,
  `runswmm.ts`) with the types removed, and four changes made after checking it against glibc
  (`js/test/run_crtcheck.sh`, and `js/test/nan_paths.js` for a case the replay cannot see): `strtod` now reads
  hexadecimal floats (`0x1.8p+1`, rounded exactly) and NaN
  payloads (`nan(0x7b)`) as glibc does; `atoi` and `sscanf %d` saturate to `LONG_MAX`/`LONG_MIN` as glibc's
  `strtol` does before the value is cut to 32 bits (`"99999999999999999999"` gives -1 as in C, where the
  TypeScript runtime gave 0); `%lu`/`%lx`/`%lo` print a negative long as an unsigned 64-bit number; and `strtod`
  passes its result through a `Float64Array` instead of a JavaScript array, because V8's optimised code returned
  `strtod("-nan")` as `nan`, sign bit cleared, once the function was hot (lessons/30). Replayed through the
  TypeScript runtime, the glibc cases differ in 964 places (`js/results/crtcheck_ts_runtime.txt`); none of them is
  reached by the 480 gate models (the TypeScript port passes them all), but each is a case where the TypeScript
  runtime and glibc disagree.

So this port is best read as the TypeScript port without TypeScript, with a runtime checked against the C
library.

## The parity contract

The same as the earlier ports' (see `go/` or the swmm5-go repository): EPA SWMM 5.2.4 built from the USEPA v5.2.4
tag with gcc 13.3 `-O2` on x86-64 Linux with glibc 2.39 (`ref/Makefile`), on a processor with FMA and AVX2; each
model run in its own folder; pass = `.out` byte-identical (when EPA writes one) and `.rpt` identical after removing
`Analysis begun on`, `Analysis ended on` and `Total elapsed time`, the exit code the same (EPA's command line always
exits 0). When an input error stops EPA before it writes results, the engine must not write a results file either.
Corpus: the 480 gate models of `gate/models_all.tsv` from SWMMBobSWMM6/1729-SWMM5-Models-2030.

## Run

Requires Node.js 18 or newer (tested with **Node v22.23.4**); nothing to install or build.

```sh
js/runswmm model.inp model.rpt model.out          # = node js/runswmm.js ...
```

To regenerate the engine: `python3 tools/c2x/emit_js.py js/swmm5` from the repository root (needs
`pip install libclang==18.1.1` and the clang 18 headers at `/usr/lib/llvm-18/lib/clang/18/include`; about 35 s).
To regenerate the math: `js/make_glibm.sh GIMPLE_DIR TABLES_JSON` (the outputs of `tools/libm/build_glibm.sh` and
`extract_tables.py`).

## Files

| File | Lines | What |
|---|---|---|
| `swmm5/engine.js` | 41,351 | generated by `tools/c2x/emit_js.py` from EPA's 54 C files |
| `swmm5/glibm.js` | 5,027 | generated by `tools/libm/gim2x.py js`: glibc 2.39's exp, log, log10, pow, sin, cos, tan, asin, acos, atan (FMA builds), plus the hand-written pow fast path and SVID wrappers it appends |
| `swmm5/glibm_rt.js` | 236 | the math runtime (exact fma, bit casts, x86 conversions, glibc's error helpers, `branred.c`); a copy of `tools/libm/glibm_rt.js` |
| `swmm5/crt.js` | 871 | the C library pieces SWMM uses: printf, strtod, sscanf, strings, stdio |
| `swmm5/overrides.js` | 180 | hand ports of `odesolve.c`, `mempool.c` and six helpers that use pointer arithmetic |
| `runswmm.js` | 38 | EPA's `run/main.c` |

The value model is the TypeScript port's: numbers are doubles kept exact where C wraps or truncates
(`Math.imul`, `(a / b) | 0`, `(0 - x)` so that no int becomes -0, `>>> 0` for unsigned; lessons/10), double to int
through `R.D2I` (x86-64's cvttsd2si), float through `Math.fround` after every float operation, `char*` as `CPtr` (a
`Uint8Array` and an offset), numeric arrays as typed arrays, a pointer to one number as an object with `.v`,
structs as classes with `clone()`.

## The runtime and the math library

- **Math.** V8's own `Math.pow`, `exp`, `sin`, ... are not glibc's (V8's `Math.pow` differs from glibc on 9.1% of
  the arguments tested in lessons/09), so the engine calls `swmm5/glibm.js` for exp, log, log10, pow, sin, cos, tan,
  asin, acos and atan. `Math.sqrt`, `Math.abs`, `Math.floor` and `Math.ceil` are used directly: they are exact
  operations, the same in every correct library. Checked bit for bit against the system libm, NaN signs included,
  by `js/test/run_libm_tests.sh` (`js/results/libm_tests.txt`): 11,000,672 random arguments over SWMM's ranges
  (`tools/libm/test/mkvectors.c`, a million per function, fma included), 3,300,000 edge cases (`mkedge.c`: huge
  trigonometric arguments, negative bases, overflow, underflow, subnormals) and 20 million arguments of pow's fast
  path against the full translation: **0 differ**.
- Adding the JavaScript back end left the other back ends' output unchanged: `js/test/check_gim2x_regen.sh`
  regenerates the TypeScript, Java, Go and Kotlin translations with the new `gim2x.py` and compares them with the
  shipped files (`js/results/gim2x_regen.txt`: all identical; the JavaScript one regenerates identical too).
- **printf/strtod/sscanf.** Checked against glibc 2.39 by `js/test/run_crtcheck.sh` (the 1,394,252 cases of
  `tools/crt/test/mkfmt.c` that the Go, Zig, Pascal and Ruby runtimes replay; `js/results/crtcheck_result.txt`):
  **1 differs**, `%#g` of 999999.5 (glibc `1.e+06`, the port `1.00000e+06`), the case the other runtimes also
  report; SWMM never uses `%#g`. 4,402 of the `%ld` cases are skipped: values beyond 2^53, which the port's long, a
  JavaScript number, cannot hold (SWMM's longs are counts and file positions).
- NaN: x86 makes NaNs with the sign bit set and glibc prints them as `-nan`; the runtime never writes JavaScript's
  `NaN` literal where C would compute a NaN (lessons/10).

## How it was checked

| Run | Engine | Models | Result |
|---|---|---|---|
| js_1a, js_1b | first runtime (before the `Float64Array` change to strtod) | quarters 1 and 2 | 238 of 238 (`js/results/discovery/`) |
| **js_2a to js_2d** | **final engine, runtime and math** | **all 480, in four quarters** | **480 of 480** |
| js_va to js_vd | the same, regenerated from the translators into a clean folder | all 480, in four quarters | 480 of 480 (1,796 s) |
| js_main | the same, from a clean checkout of the repository (the main session's check) | 45 drawn at random from the 480, plus the three decks that SAVE and USE `cho.txt` | 48 of 48 |

All runs: `js/gate/run_chunk.sh NAME IDS`, which runs `python3 gate/gate.py NAME "$PWD/js/runswmm_saves.sh" --ids
IDS -j 1 --timeout 1800 --prune` inside `flock` on the shared corpus lock, with the output folder in `/dev/shm`
(lessons/22). `runswmm_saves.sh` is the Ruby port's wrapper with the engine changed: it backs up every file a deck
SAVEs (listed by the swmm6-rust repository's `gate/savefiles.py`, called read-only), and the backslash spelling of
`[LID_USAGE]` report files (lessons/29), and restores them after the run. `Hydrology/cho.txt` was 1,114,474 bytes,
md5 5b0ca1fe78588202fa779dbfa417b089, after the last run.

Before the independent rerun, `engine.js` and `glibm.js` were regenerated from `tools/c2x/emit_js.py` and
`tools/libm/gim2x.py` into a separate folder, with the hand-written files copied beside them; the regenerated
files are byte-identical to the ones in this folder, and the rerun ran from that folder.

The main session then checked the result itself from a clean clone of the working repository at commit 72eb429
(the JavaScript files unchanged since ccd8b49): run js_main, ids in `js/gate/ids_main_check.txt`, record in
`js/results/js_main.json`. `cho.txt` was unchanged after it.

## What this does not show

- That SWMM is right: identical to EPA means EPA's answers, good or bad.
- Other platforms or CPUs: the port carries glibc's FMA routines, so it matches EPA run on an x86-64 processor with
  FMA and AVX2, on any machine; it would not follow EPA onto a processor without FMA, where glibc picks other
  routines and EPA itself changes 43 of the 480 models (lessons/09).
- Paths no gate model exercises: streets and inlets (one deck, which stops on input errors), climate files,
  USE HOTSTART, USE INFLOWS, USE RUNOFF; the stepping API is translated but only the command line was gated.
- A checked run: JavaScript is memory-safe but not C-safe. Reading past the end of a typed array gives
  `undefined` (which becomes NaN in arithmetic) and writing past it does nothing, so a C overrun would not stop the
  engine; the gate sees it only if it changes an output. No equivalent of the Zig and Pascal checked builds exists.
- Longs above 2^53: a C `long` is a JavaScript number here. SWMM's longs (counts, file offsets, date-time
  integers) stay far below 2^53 in every gate model; a value above it would lose its low bits.
- Speed beyond the gate's own clock: no interleaved benchmark against EPA was run (lessons/07).
- No person has reviewed the generated code line by line; the evidence is the gate, the comparison with the
  TypeScript port, and the runtime and math checks.

## Licence and credit

EPA SWMM is a work of the U.S. Environmental Protection Agency and is in the public domain; its engine is Lewis
Rossman's design, and this port keeps every algorithm as he wrote it. `swmm5/glibm.js` and `swmm5/glibm_rt.js`
(and their sources in `tools/libm/`) are translations of glibc 2.39 code and remain under glibc's licence, the GNU
Lesser General Public License 2.1 or later (`ref/LGPL-2.1.txt`). No licence has been chosen yet for the translator
and the runtime.

## AI use

The translator back end (`tools/c2x/emit_js.py`), the JavaScript back end of `tools/libm/gim2x.py` and
`tools/libm/glibm_rt.js`, the runtime (`swmm5/crt.js`, `swmm5/overrides.js`, `runswmm.js`), the generated engine
and math library, the launcher, gate scripts and checks, and this README were written by Claude (Anthropic's AI
model, Claude Opus 5.5) in a Claude Code session on 8 November 2026, for Robert (Bob) Dickinson, who asked for
JavaScript among the Code Rosetta Stone languages and set the byte-for-byte standard. Most of the work is the
TypeScript port's, written by Claude earlier for the same project, carried over as described above. Claude ran
every gate and check reported here. The checks are mechanical; no person has yet reviewed the code.
