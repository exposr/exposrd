# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.4](https://github.com/exposr/exposr-server/compare/v0.1.3...v0.1.4) (2021-07-15)


### Features

* **http-ingress:** send forwarded headers to target ([722bd30](https://github.com/exposr/exposr-server/commit/722bd30bbca889028dcba61e8776abc4efcd7e38))
* don't require api url to be specified ([e70b198](https://github.com/exposr/exposr-server/commit/e70b198873f14507245397cda4859329e0f5f985))


### Bug Fixes

* **account-service:** remove unused import ([548e726](https://github.com/exposr/exposr-server/commit/548e7267d841800154b9f6ab843c9bc7e0d92655))
* **api-controller:** organize imports ([a1fbd8f](https://github.com/exposr/exposr-server/commit/a1fbd8fbea380f1cd3f569972501d87b01d7b22a))
* **endpoint:** move to base64url ([4b594b6](https://github.com/exposr/exposr-server/commit/4b594b69838c21297bd80b439033297ef227d2b7))

### [0.1.3](https://github.com/exposr/exposr-server/compare/v0.1.2...v0.1.3) (2021-06-29)


### Bug Fixes

* run with --no-deprecation in container ([1c47ef8](https://github.com/exposr/exposr-server/commit/1c47ef82eaba6cd2ac15394e663fecac3fcdeafa))
* **http-captor:** remove unused variable ([9930975](https://github.com/exposr/exposr-server/commit/9930975b59ca71c2c79387a3c143198a401c56bb))
* add missing semicolons ([4f5e021](https://github.com/exposr/exposr-server/commit/4f5e02100d199aa97f7ba7bee9a52c9a307d10e8))
* **account-service:** remove unused logger ([c7877f3](https://github.com/exposr/exposr-server/commit/c7877f3b8b04c14adbe64f1e95c8b6455ca5cedf))
* **admin-server:** remove unused variable ([1b8c6d8](https://github.com/exposr/exposr-server/commit/1b8c6d8e4beb7a593c82489e18651b1f62fe5f58))
* **ws-endpoint:** add missing await ([a2f0eee](https://github.com/exposr/exposr-server/commit/a2f0eee75fb8047bd3703b74beeb06add3f59153))

### [0.1.2](https://github.com/exposr/exposr-server/compare/v0.1.1...v0.1.2) (2021-06-28)

### [0.1.1](https://github.com/exposr/exposr-server/compare/v0.1.0...v0.1.1) (2021-06-28)


### Bug Fixes

* **helm:** add missing end to NOTES.txt ([aa507fa](https://github.com/exposr/exposr-server/commit/aa507fa4efa69e33b0f0f091ce6c2a5f70edc99b))
* **helm:** fix appVersion tag, should be prefixed with a 'v' ([25ad225](https://github.com/exposr/exposr-server/commit/25ad2250f9aa6ab2ab9040d19713f5d4ddbee167))

## 0.1.0 (2021-06-24)


### Features

* **admin-controller:** convert to using the http-listener ([3da7b4f](https://github.com/exposr/exposr-server/commit/3da7b4f5810874c5e3e3326d8cf8cbd3d765a2e2))
* **config:** hide obscure options by default ([a078a7f](https://github.com/exposr/exposr-server/commit/a078a7f5974347705c930d1b971c4ceb8790b85f))
* **helm:** bump helm appVersion on release ([e2d61eb](https://github.com/exposr/exposr-server/commit/e2d61eb510d00cbdb31c76496e2c15b741ad99cc))
* **helm:** initial helm chart ([8e76ae5](https://github.com/exposr/exposr-server/commit/8e76ae583d151fa976f7f494094bf930fc30ba4d))
* unified http request/reponse logging ([4cd9740](https://github.com/exposr/exposr-server/commit/4cd9740ba16eaf7b01bb108848cd6f7a42e3ad95))
* **account:** keep last updated timestamp ([26951ba](https://github.com/exposr/exposr-server/commit/26951ba4b36e2bc1ee4ae6bdac5f5f6b980b47d0))
* **account:** keep track of tunnels on account level ([77c8a18](https://github.com/exposr/exposr-server/commit/77c8a18702286893dc7751c7e7f5cc1f8d459e96))
* **http-ingress:** get port of http listener ([35b4a3b](https://github.com/exposr/exposr-server/commit/35b4a3b2a28c86026bf8ba444436240a22c2b919))
* **http-ingress:** improve request/response logging ([56886d7](https://github.com/exposr/exposr-server/commit/56886d7226013f583986306cde962547473ff1a3))
* **http-ingress:** prevent request loops ([be0fe42](https://github.com/exposr/exposr-server/commit/be0fe42b1f2aba71660a2d7b4886b7cacadf266f))
* **logger:** log hostname for each entry ([8908958](https://github.com/exposr/exposr-server/commit/89089589dc712a7c726975697484dc0bda34eb3c))
* **node:** cache node lookups ([dc2d110](https://github.com/exposr/exposr-server/commit/dc2d1106195ae48531d8c120fa991bfa33b9d28c))
* **node-socket:** add target node in toString() ([2da7b9e](https://github.com/exposr/exposr-server/commit/2da7b9e7a748335d15f5003fc07f743600359b82))
* **storage:** add list() method that can query all keys in a namespace ([5fb2ebb](https://github.com/exposr/exposr-server/commit/5fb2ebbbb2fcb068aa7344fdd4ae2d14e5f2a10a))
* **tunnel:** keep last updated timestamp on tunnel object ([ba87f97](https://github.com/exposr/exposr-server/commit/ba87f97a1c8291ce96df98c810af12dcff4738c2))
* **tunnel-server:** reset stale connection state on disconnect ([0cb3fbd](https://github.com/exposr/exposr-server/commit/0cb3fbd52033a4b13e60998d6cf8dc4651d7a1db))
* **tunnel-service:** preemptively refresh lookup cache ([8974cbb](https://github.com/exposr/exposr-server/commit/8974cbb0cc9256b308e1abb4b785617b831eff7d))
* display package and/or build version ([49fe22a](https://github.com/exposr/exposr-server/commit/49fe22ae41154e9717cc842e8f8bef19fed4820c))
* return error codes as enum values instead of strings ([49a2a27](https://github.com/exposr/exposr-server/commit/49a2a27c4a7f9978156e7c56fa5a416e30dad6d6))


### Bug Fixes

* **eventbus:** decrease max listeners on removelistener event ([b4ea1d6](https://github.com/exposr/exposr-server/commit/b4ea1d6e822b649c9fbda8c760df78d5a3bc6b09))
* **http-captor:** 'data' might not be the first listener attached ([714c726](https://github.com/exposr/exposr-server/commit/714c726973cf27ca0a66d8c8c7896609701e844a))
* **http-captor:** construct both promises before waiting ([c735a78](https://github.com/exposr/exposr-server/commit/c735a78f6c932b3587f0d6e5ba3e5439968fdd60))
* **http-captor:** handle undefined ([464c96e](https://github.com/exposr/exposr-server/commit/464c96effc146884f11d2babeaefa21ce5812496))
* **http-captor:** log request/response time in millis without decimals ([53b79f6](https://github.com/exposr/exposr-server/commit/53b79f6109878090274532a9432337d2914fdf9d))
* **http-ingress:** agent cache ttl update ([a72455d](https://github.com/exposr/exposr-server/commit/a72455db518b2123b9bb47e3ec90d20686a4df7b))
* **http-ingress:** call correct createConnection ([c0c02ae](https://github.com/exposr/exposr-server/commit/c0c02ae2b96946b32198410eb41f263709c1c82d))
* **http-ingress:** don't expire http agent with on-going requests ([f128db9](https://github.com/exposr/exposr-server/commit/f128db9f2aa4058d7493f8a07c5151c7640fe702))
* **http-ingress:** improve subdomain matching ([599bf33](https://github.com/exposr/exposr-server/commit/599bf332724ef6e4795ee162161c8d9604244170))
* **http-ingress:** log path of request ([eba9117](https://github.com/exposr/exposr-server/commit/eba9117d3d9c2f1e80620406339461ed77f40f03))
* **http-ingress:** make agent cache expiry more resilient ([897e711](https://github.com/exposr/exposr-server/commit/897e711d3438949a1d090a47d94a0127ab5e7f80))
* **http-ingress:** only remove connection header in certain conditions ([ed512fd](https://github.com/exposr/exposr-server/commit/ed512fd8d16a15e3f2a9932b53a93a8bdee38df6))
* **http-ingress:** return 503 if fail to obtain a socket ([2803a9a](https://github.com/exposr/exposr-server/commit/2803a9a15fb283404f9fc4859d26fa6e5fb978ac))
* **http-ingress:** use of undefined variable ([a8b8ca3](https://github.com/exposr/exposr-server/commit/a8b8ca3006b3819c991ab2962b883900a7370917))
* **http-listener:** return 404 if no handler claims the request ([9ae8d9b](https://github.com/exposr/exposr-server/commit/9ae8d9b744d1a52ce36c182b14743e7b6f0ed063))
* **logger:** add host to logging context ([55e36f1](https://github.com/exposr/exposr-server/commit/55e36f1f3efef29a6159f5a9f0ecc833276635a2))
* **serializer:** properly deserialize arrays ([25701a1](https://github.com/exposr/exposr-server/commit/25701a1488bd583a6ffb9127b02bbfa4d6938b74))
* **tunnel-server:** delete tunnel state on tunnel deletion ([dda2159](https://github.com/exposr/exposr-server/commit/dda215962b8cd73bee593d3ac42db716b65eef7b))
* **tunnel-server:** reduce disconnection wait time to 4500ms ([d160a3a](https://github.com/exposr/exposr-server/commit/d160a3ac24a2f0080cc7e029ac17d969f6e73096))
* **tunnel-server:** set TTL on initial state creation ([9368d73](https://github.com/exposr/exposr-server/commit/9368d736e2e0eb7cda102931dfe37ca5b164858e))
* **tunnel-server:** use allSettled instead of all ([8af3689](https://github.com/exposr/exposr-server/commit/8af36891611094e7df96e10201ec103cdf1f919f))
* **tunnel-service:** fix tunnel lookup cache expiry ([3a6106d](https://github.com/exposr/exposr-server/commit/3a6106db10eda2576fc5bc685997983dc057bf63))
* **tunnel-service:** use of undefined variable ([b7b9875](https://github.com/exposr/exposr-server/commit/b7b9875a067be82f5e3e310e5eaf52ff563dfe5f))
* **tunnel-service:** wrong function called to read node ([a60c927](https://github.com/exposr/exposr-server/commit/a60c927dc9050741da885a5c85c1b47b55ad3399))
* **ws-transport:** performance improvements ([ef42a2a](https://github.com/exposr/exposr-server/commit/ef42a2a7a00b63b0ccee525bc62f8a64bed6e851))
* adminController might not be initialized ([35774a0](https://github.com/exposr/exposr-server/commit/35774a08d67c8fb11a73f6b630f41871dd8c1171))
* setTimeout takes ms, TTL is in seconds ([9106963](https://github.com/exposr/exposr-server/commit/910696394e5432392eed3f7c699d57c1e324ef74))
* spawnSync syntax ([59b85aa](https://github.com/exposr/exposr-server/commit/59b85aa54057100ab20da8ee9c442c76950f05ba))
* use of uninitialized variable ([1f8372a](https://github.com/exposr/exposr-server/commit/1f8372aaa8d0b53ebd248ed6653a8a67b9ef2754))
