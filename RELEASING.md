# Releasing

Release only with the **Release standalone plugin** workflow (Actions, then Run workflow, with the full commit SHA on `main`), never from a workstation.

- It builds in the pinned Fedora 44 container (`zlib-ng-compat-2.3.3-3.fc44`), runs the tests, builds the archive twice, checks that it loads outside the repository, then creates `v<version>` at that commit with the archive attached. The WABS index entry points at that asset, with its SHA-256.
- The archive's tar bytes are reproducible everywhere, but its gzip bytes depend on the zlib implementation (stock zlib and zlib-ng compress differently). That is why the builder is pinned, and why `validate.yml` builds in the same container.
- For a version that is already installed somewhere, pass that archive's SHA-256 as `expected_sha256`. WABP refuses a version whose bytes change ("already names different immutable bytes"), so the release must carry exactly those bytes.
- A local `npm run release:archive` is for testing. Its output names the `zlib` it used, and it reproduces the release bytes only with the same one (Fedora 44 prints `1.3.1.zlib-ng`).
- Bump the version in `package.json`, `package-lock.json` (twice), `wa-plugin.json` and `src/manifest.ts` before releasing changed content. Anything in the package's `files` list, including `README.md`, changes the archive.

## Published before the canonical builder

`v0.2.0` (`official.geocoder-0.2.0.tgz`, SHA-256 `673f1716fbc797b2f11a5b2a47f1f1a9d93ca5c4cacc58912ba7f03bd904c608`) was built by the previous Ubuntu CI builder (stock zlib). It stays as published, because a version's bytes never change. A Fedora 44 build of the same commit gives `956048a0ca1b4fd589ed56a88ef6da6d92886a71aa7b7933e23d9bf682a6cacf` from the identical tar stream (`2dbca17451eaf6037c9af74e8d2c58e75b50c096edde8089b5cf58c3e8e5a43d`). No check compares a fresh build of 0.2.0 or earlier with those assets; versions after 0.2.0 come from `release.yml`.

Earlier releases also attached a signature, `SHA256SUMS`, `validation.json` and a public key. WABP and the WABS index use only the archive and its SHA-256, so `release.yml` attaches the archive alone.
