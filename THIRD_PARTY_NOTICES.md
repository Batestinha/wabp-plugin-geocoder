# Third-party notices

The archive includes the original package metadata and license files for its production dependencies. Exact versions and integrity digests are recorded in `package-lock.json`.

The `geo-tz` code is Copyright (c) 2016 Evan Siroky, licensed under MIT. Its `LICENSE.md` is retained in the archive. The plugin uses the comprehensive `find-all` data product from geo-tz 8.1.8 without modifying its boundary data. Packaging omits the unused 1970 and future-only data products; their names and original digests are recorded in `packaging.json`.

Contains information from [Timezone Boundary Builder](https://github.com/evansiroky/timezone-boundary-builder), made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The upstream [data license](https://github.com/evansiroky/timezone-boundary-builder/blob/master/DATA_LICENSE) applies to these boundaries. The source data includes contributions by [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The redistributable data remains available inside the release archive under `node_modules/geo-tz/data`.

Nominatim lookup results retain the provider's OpenStreetMap attribution. Deployments may configure a different Nominatim endpoint; this does not change the licensing of the offline timezone dataset.
