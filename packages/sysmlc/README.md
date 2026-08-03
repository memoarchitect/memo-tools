# @memoarchitect/sysmlc

MEMO's SysML v2 compiler, shipped as a tool.

MEMO integrates every compiler and validator the same way: spawn a binary, speak
a declared protocol, normalize what comes back. `sysmlc` is MEMO's own compiler
packaged to that same contract, so there is no tool in the system that gets
special treatment — including MEMO's.

That matters for a reason beyond symmetry. In-process, a contract can be
cheated: objects pass by reference, state is shared, serialization is skipped.
Over a pipe none of that is possible. Shipping the compiler as a process is how
MEMO meets its own IR and diagnostic contract before anyone else has to.

## Usage

```
sysmlc check [dir]              # parse a project, report what it could not read
sysmlc emit-ir [dir]            # lower a project and write its IR as JSON
sysmlc serve --stdio            # run as a language server
sysmlc --protocol-version       # the protocol version this build speaks
```

`check` and `emit-ir` exit non-zero when the revision has errors, the way a
compiler does. `emit-ir` writes the IR either way: partial IR for a broken
revision is what lets a diagram draw what *was* understood instead of blanking.

## Protocol

`serve --stdio` speaks LSP — document synchronisation, diagnostics,
cancellation, lifecycle — plus exactly one custom request:

- **`memo/emitIr`** → `{ projectDir, revision, protocolVersion }`

  Returns the project's IR, or `{ outcome: 'superseded', supersededBy }` when a
  newer revision arrived while this one was compiling. A superseded revision is
  never answered with the model it finished computing: drawing a revision the
  user has already edited past, with nothing to say so, is worse than waiting.

The protocol and IR are versioned separately and independently, and the version
is checked on every handshake. The whole point of a declared boundary is that it
outlives the implementation behind it.

The protocol's types live in `@memoarchitect/tools`, because both sides have to
agree on them and only one side can own them. This package implements the
protocol; it does not define it.

## License

MIT
