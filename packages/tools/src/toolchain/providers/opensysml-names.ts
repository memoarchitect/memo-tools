// ─── What this compiler is called ────────────────────────────────────────────
//
// Every name MEMO uses for the OpenSysML service, in one place. The project is
// considering a new name (Open-MBEE/OpenSysML#987), and a rename should be a
// change here, a `git mv` of the `opensysml-*.ts` files, and a replace over
// prose — not a hunt through the providers.
//
// To rename:
//   1. Edit this file: the provider id (the value of `toolchain.compiler`), the
//      display name, the npm package and the environment variable names.
//      People will have the old provider id in their settings and the old
//      variables in their shells: accept both for a release (a one-line
//      mapping where `toolchain.compiler` is read, and `process.env[old]`
//      where the variables are), saying which is deprecated. Not built yet.
//   2. `git mv` toolchain/providers/opensysml*.ts and the `opensysml-*.test.ts`
//      files; the imports follow the file names.
//   3. Replace the prose: `grep -rIl "OpenSysML\|opensysml" docs README.md ../memo/docs`.
//   4. The settings keys under `toolchain.` (`opensysml.binary`, …) are built from
//      the provider id, so they follow step 1.
//   5. The pinned dependency in package.json.
// ─────────────────────────────────────────────────────────────────────────────

/** The value of `toolchain.compiler` (and of the provider's settings key). */
export const OPENSYSML_PROVIDER_ID = 'opensysml';

/** How messages and docs name it. */
export const OPENSYSML_DISPLAY_NAME = 'OpenSysML';

/** The npm package the Node client is imported from. */
export const OPENSYSML_NPM_PACKAGE = '@openmbee/opensysml';

/** The environment variables that locate the service. */
export const OPENSYSML_ENV = {
    /** The `sysml-grpc` executable the client starts. */
    binary: 'OPENSYSML_BINARY',
    /** The address of a running service. */
    service: 'OPENSYSML_SERVICE',
    /** The module the client is imported from, over the package. */
    client: 'MEMO_OPENSYSML_CLIENT',
} as const;

