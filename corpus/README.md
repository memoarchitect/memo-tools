# SysML v2 Release corpus

Vendored artifacts from [`Systems-Modeling/SysML-v2-Release`](https://github.com/Systems-Modeling/SysML-v2-Release),
pinned to one commit and checksummed file by file. They are the reference the
project cites: the normative textual grammar (`bnf/*.kebnf`), the standard
library, and the OMG's own example models. Nothing in the toolchain reads them
at run time.

Upstream paths are preserved verbatim, so every entry in
`sysml-v2-release/manifest.json` can be checked against the Release repository
by path and commit without consulting any script here.

## What is here

| Tree | What it is |
| --- | --- |
| `bnf/*.kebnf` | The normative textual grammar, cited by file and line |
| `bnf/SysML-graphical-bnf.kgbnf` | The graphical grammar |
| `sysml.library/` | The normative libraries in textual form |
| `sysml.library.xmi/` | The libraries' declared semantics, before implication |
| `sysml.library.xmi.implied/` | The reference implementation's computed output, published as data |
| `sysml.library.kpar/` | The libraries as published KPARs |
| `sysml/src/`, `kerml/src/` | The Release's example and training models |

`manifest.json` records the pinned commit, its date, the library versions read
off the KPAR filenames, a SHA-256 per file, and one roll-up digest over all of
them. It is not published: `files` in `package.json` is an allowlist and does
not list it.

`memo conformance`, which graded MEMO's own SysML compiler against this corpus,
was retired with that compiler; the selected compiler is the authority on
validity.

## Commands

```bash
# re-vendor at the pinned commit
node scripts/vendor-corpus.mjs

# verify the working tree against the manifest, no network
node scripts/vendor-corpus.mjs --verify

# move the pin: a deliberate act with a reviewable diff
node scripts/vendor-corpus.mjs --commit <sha>
```

`vendored-corpus.test.ts` runs the verification in the suite.
