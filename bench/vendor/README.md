# vendor

`graphology.js` bundles [graphology](https://github.com/graphology/graphology) 0.26.0 and graphology-layout-forceatlas2 0.10.1 (both MIT, (c) Guillaume Plique) with the `events` polyfill (MIT), because NSH does not provide Node's `events` module. Rebuild it with:

```sh
bun build vendor/graphology-entry.js --target=browser --format=esm --outfile vendor/graphology.js
```
