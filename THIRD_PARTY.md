# Attribution and provenance

The static parser, interpreter, VM lifter and optimization passes in `vendor/prostone/src`
are derived from [prostone4/Prometheus-Deobfuscator](https://github.com/prostone4/Prometheus-Deobfuscator),
commit `df4fe6cce109f1f660414021a463632562b8ac82`, copyright (c) 2026 LeakD,
MIT license (included at `vendor/prostone/LICENSE`).

Local modifications: restore missing jump-cleanup constants; preserve control transfers during decoder-prelude cleanup; make failed passes
transactional; expose snapshots after each pass. New orchestration, validation,
tracing, CLI and tests live outside vendor/.

Design references:
- 0x251/Prometheus-DeobfuscatorV2: per-pass metrics/snapshots and dynamic observations.
- hutaoshusband/Prometheus-WeAre-Devs-Dumper: mock Roblox observations and constant reports.

No source from those two projects is copied. Their trace output is not treated as
an equivalent replacement for the input program.

Test fixtures are obfuscations of this project's own synthetic Lua examples,
generated with wcrddn/Prometheus at `a4efc5f381c50ae2a111bdbb9272fa3203685be3`.
The generator is an external test tool; its source is not distributed here.
