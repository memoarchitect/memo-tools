# Conformance corpus

Vendored artifacts from [`Systems-Modeling/SysML-v2-Release`](https://github.com/Systems-Modeling/SysML-v2-Release),
pinned to one commit and checksummed file by file. `memo conformance` reads
them; nothing else in the toolchain does.

Upstream paths are preserved verbatim, so every entry in
`sysml-v2-release/manifest.json` can be checked against the Release repository
by path and commit without consulting any script here.

## What is here, and what each tree is for

| Tree | Oracle role |
| --- | --- |
| `sysml.library/` | Positive parse+link corpus — the normative libraries in textual form |
| `sysml.library.xmi/` | Declared semantics, before implication |
| `sysml.library.xmi.implied/` | **Differential oracle** — the reference implementation's own computed output, published as data |
| `sysml.library.kpar/` | The libraries as published KPARs |
| `bnf/*.kebnf` | Textual grammar — parser conformance target |
| `bnf/SysML-graphical-bnf.kgbnf` | Graphical grammar — notation conformance target |
| `sysml/src/`, `kerml/src/` | Regression corpus — the Release example models |

`manifest.json` records the pinned commit, its date, the library versions read
off the KPAR filenames, a SHA-256 per file, and one roll-up digest over all of
them. Every conformance result carries the commit and the digest, so a report
always says which Release it was taken against.

`baselines/` holds the frozen reports CI regresses against. They live beside the
corpus rather than with the test fixtures because a baseline is only meaningful
against one pin — keeping them together means moving the pin puts the stale
baseline in the same diff.

Neither directory is published: `files` in `package.json` is an allowlist and
lists neither.

## Commands

```bash
# re-vendor at the pinned commit
node scripts/vendor-corpus.mjs

# verify the working tree against the manifest, no network
node scripts/vendor-corpus.mjs --verify

# run the sweeps and compare against the frozen baselines
node scripts/check-conformance.mjs
```

## Moving the pin

Changing the commit changes what conformance means, so it is a deliberate act
with a reviewable diff:

```bash
node scripts/vendor-corpus.mjs --commit <sha>
pnpm build
node packages/tools/lib/bin/memo.js conformance run --update-baseline
node packages/tools/lib/bin/memo.js conformance diff-xmi --update-baseline
```

Also update `PINNED_COMMIT` in `scripts/vendor-corpus.mjs` so a plain re-vendor
reproduces the new pin. A baseline taken against a different pin is refused
rather than compared — a corpus bump must never read as a regression.
