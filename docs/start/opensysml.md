# Install and Configure OpenSysML

OpenSysML is the open-source SysML v2 compiler from Open-MBEE. A project that
sets `toolchain.compiler: opensysml` uses it as both validator and lowering, in
place of [SysIDE](syside.md). MEMO has no compiler of its own: either one produces
the SysML v2 API JSON that the rest of MEMO builds from.

!!! note "Newer than SysIDE support"
    OpenSysML support arrived in MEMO 0.15.0 and is labelled experimental there.
    It has had less use than the SysIDE path. Pin an exact MEMO version.

## Install

There is nothing to install by hand. MEMO depends on the pinned npm package
`@openmbee/opensysml`, and `npm install` fetches the platform package that holds
the `sysml-grpc` service for your operating system and CPU
(`@openmbee/opensysml-sysml-grpc-<platform>-<arch>`, an optional dependency).
MEMO starts one `sysml-grpc` process per MEMO process, or connects to one that is
already running.

```bash
npm install @memoarchitect/tools    # brings the OpenSysML client with it
memo compile --probe                # shows whether the opensysml provider is available, and its version
```

When the platform package is not installed, the client looks for a `sysml-grpc`
on `PATH`. You can also point MEMO at one (below).

## Configure a project

Name the compiler in the project's checked-in `memo.package.yaml` (or
`memo.tools.yaml`):

```yaml
toolchain:
  compiler: opensysml
```

Or switch for yourself, without editing the project:

```bash
memo-architect config set compiler opensysml            # yours alone
memo-architect config set compiler opensysml --project  # the whole project
memo-architect config get                               # which layer decided it
```

To try a project against OpenSysML for one command:

```bash
memo validate --toolchain.compiler=opensysml
```

### Settings for one machine

These belong to one machine, so a project's checked-in file may not carry them. Set
them with `memo-architect config set <setting> <value>`, with a flag, or with a
variable. Most people never need them.

| Setting | Variable | Use |
| --- | --- | --- |
| `toolchain.opensysml.binary` | `OPENSYSML_BINARY` | the `sysml-grpc` executable to start, instead of the one the platform package installed |
| `toolchain.opensysml.service` | `OPENSYSML_SERVICE` | the address of a `sysml-grpc` that is already running, used instead of starting one |
| `toolchain.opensysml.client` | `MEMO_OPENSYSML_CLIENT` | a built `dist/node/index.js` of the Node client, to try a client ahead of its release |

A long-lived MEMO process (`memo dev`, Architect) keeps the service running and
re-parses a file only when it changes, because the service caches a parsed model by
its content.

## Differences from SysIDE

- OpenSysML parses the project and its library roots as one model, so the
  SysIDE settings (`toolchain.syside.*`, including `syside.toml`) do not apply to it.
- `validator-exceptions.json` entries name a provider. An entry written for
  `syside` is ignored when OpenSysML runs, and is not reported stale.
- There is no separate Python interpreter to find: everything runs through the
  Node client.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `opensysml` shown unavailable in `memo compile --probe` | The platform package did not install. Run `npm install` again, or set `OPENSYSML_BINARY`. |
| `No SysML compiler is configured` | Set `toolchain.compiler`. |
