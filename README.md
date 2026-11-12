# Geocoder for WABP

This optional plugin provides forward and reverse geocoding, map links, and offline timezone lookup to other plugins. Its stable plugin ID is `official.geocoder`. WABS lists immutable release archives; WABP downloads the package only when it is installed.

It also owns location disambiguation for every plugin: which place a person means when they type a name. The `resolve` method leaves notes such as "(maybe?)" and alternatives ("A/B", "A ou B") out of the search, puts places this community confirmed before first, biases the search (without limiting it) to the area of those places, ranks and de-duplicates the results, and says whether the first one is certain (`resolved`), only the best guess (`ambiguous`), or missing (`not_found`), with ready-made numbered lines and a one-line list of the other places. `choose` reads a reply to such a list: a number, "ok" for a certain or only place, a typed place name, the same search again (answer with the number), or a new search. `remember` records a confirmed choice, with the words used for it, in the scope's durable plugin data (at most 300 places; only changes are written). Community Events and Weather use these methods instead of their own rules.

The existing place selection identifies the location. Its coordinates determine the IANA timezone automatically, including the distinction between mainland Portugal, Madeira, and the Azores. There is no additional timezone question. An ambiguous boundary result has no single inferred timezone and requires a more precise location.

Provider URL, language, country filters, request spacing, and cache settings use WABP's normal scoped configuration and console controls. They retain their existing keys. Cached requests remain isolated by scope and provider configuration. No account data or credentials are included in this repository or its releases.

Run `npm ci --ignore-scripts`, `npm test`, and `npm run release:archive` (Node 22+ and Python 3). The archive contains compiled code, console metadata, Portuguese translations, the pinned SDK, and the complete production dependency closure, including its comprehensive timezone boundary data. The reproducible archive omits the unused 1970 and future-only datasets; `packaging.json` records those omissions and retained data digests. Installation does not run npm or a build script. Tests mock all provider traffic.

`provenance.json` records the extraction source and the vendored SDK digest. `package-lock.json` pins every resolved dependency, including indirect dependencies. Dependency maintenance must refresh these pins through validation and rollback policy; vendoring is not a permanent hold.

Code is licensed under MIT. Timezone boundaries have separate attribution and licensing described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
