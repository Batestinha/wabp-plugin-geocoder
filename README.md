# Geocoder for WABP

This optional plugin provides forward and reverse geocoding, map links, and offline timezone lookup to other plugins. Its stable plugin ID is `official.geocoder`. WABS lists immutable release archives; WABP downloads the package only when it is installed.

The existing place selection identifies the location. Its coordinates determine the IANA timezone automatically, including the distinction between mainland Portugal, Madeira, and the Azores. There is no additional timezone question. An ambiguous boundary result has no single inferred timezone and requires a more precise location.

Provider URL, language, country filters, request spacing, and cache settings use WABP's normal scoped configuration and console controls. They retain their existing keys. Cached requests remain isolated by scope and provider configuration. No account data or credentials are included in this repository or its releases.

Run `npm ci --ignore-scripts`, `npm test`, and `npm run release:archive` (Node 22+ and Python 3). The archive contains compiled code, console metadata, Portuguese translations, the pinned SDK, and the complete production dependency closure, including its comprehensive timezone boundary data. The reproducible archive omits the unused 1970 and future-only datasets; `packaging.json` records those omissions and retained data digests. Installation does not run npm or a build script. Tests mock all provider traffic.

`provenance.json` records the extraction source and the vendored SDK digest. `package-lock.json` pins every resolved dependency, including indirect dependencies. Dependency maintenance must refresh these pins through validation and rollback policy; vendoring is not a permanent hold.

Code is licensed under MIT. Timezone boundaries have separate attribution and licensing described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
