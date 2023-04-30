# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.8.1](https://github.com/exposr/exposr-server/compare/v0.8.0...v0.8.1) (2023-04-30)


### Bug Fixes

* crash in cluster node socket destroy ([01500ee](https://github.com/exposr/exposr-server/commit/01500ee045423687b7b5c557d7b9712587690848))

## [0.8.0](https://github.com/exposr/exposr-server/compare/v0.7.1...v0.8.0) (2023-04-30)

This release features a redesigned cluster support, notable changes include
 * In-memory eventually consistent tunnel state rather than using the storage layer.
 * Possibility to use pub/sub with native UDP networking rather than through Redis.
 * Cluster node discovery through IP multicast or K8S headless headless service.  

This release also features **client multi-connection support for tunnels**

Clients can have multiple connections open to the same tunnel with incoming traffic 
load-balanced in round-robin between connections. Requires version >= 0.8.0 of the exposr client.

### Features

* add cluster support to helm chart ([445a5ba](https://github.com/exposr/exposr-server/commit/445a5bac5e520740db605d052a41323fdfa09c73))
* add multicast UDP based eventbus ([8200add](https://github.com/exposr/exposr-server/commit/8200addccb68f555cf98f47d21d388e1fd2ce2fe))
* add native kubernetes service peer discovery to the UDP eventbus ([ce10b72](https://github.com/exposr/exposr-server/commit/ce10b724c28895e963c668ad099736493309d6f5))
* **admin-api:** add disconnect endpoint in tunnel admin api ([ae2cbc0](https://github.com/exposr/exposr-server/commit/ae2cbc0d482959a3031743920eb422af212a0927))
* **admin-api:** return full connection details when reading tunnel info ([a30d029](https://github.com/exposr/exposr-server/commit/a30d029e04132832ec58bd42fc739aa47301c268))
* allow HMAC cluster message signing key to be set on command line ([3e9085d](https://github.com/exposr/exposr-server/commit/3e9085d2cabafd2509f5ebedffcd90b6c99f7d27))
* expose cluster/storage configuration on command line ([05f4bad](https://github.com/exposr/exposr-server/commit/05f4bad8b65cff48bce3016d3314295f16cb4768))
* fully enable tunnel transport multi-connection support ([4746eda](https://github.com/exposr/exposr-server/commit/4746eda9a8af71ed1e0803b359b9e4f860648452))
* **helm:** add maxConnection support to helm chart ([3104648](https://github.com/exposr/exposr-server/commit/31046489d855836de7d5b46dc6fbe8e52e7d70fd))
* reject duplicated messages from peer cluster nodes ([d9a9899](https://github.com/exposr/exposr-server/commit/d9a98997048b287b4b9f50a6aa50d84d4191e51f))
* sign messages emitted on cluster eventbus ([8e230d5](https://github.com/exposr/exposr-server/commit/8e230d5233f7faae6a3379786feebf2b419a028a))
* support IPv6 in UDP clustering mode ([4cfbe43](https://github.com/exposr/exposr-server/commit/4cfbe43494109ee976d62308ace0b4a223243a04))
* **ws:** send reason when closing a websocket transport connection ([6d8632a](https://github.com/exposr/exposr-server/commit/6d8632afb3c57eeb09f36322584138e737376054))


### Bug Fixes

* add cluster-udp-port to cluster config group ([15f6f1a](https://github.com/exposr/exposr-server/commit/15f6f1a3c700a1829fd08b102b1a7c0aa09d2aab))
* better handling of DNS kubernetes peer discovery ([78b4732](https://github.com/exposr/exposr-server/commit/78b4732f8722fa0cd75383f38ca85321997a067b))
* do not propagate redlock unlock rejections ([9d4db47](https://github.com/exposr/exposr-server/commit/9d4db478ff65eea6fa2d2b192d780b36585f3a32))
* **redlock:** avoid error message on shutdown ([efb2459](https://github.com/exposr/exposr-server/commit/efb2459f0aaac5dcd390eeeddb7aac0252b29dd8))
* rename the ingress-http-domain option to ingress-http-url ([a508b18](https://github.com/exposr/exposr-server/commit/a508b18959c28f893756f1e8c191c6e818a50efd))
* stale timer was not properly cleared on received heartbeat ([319d294](https://github.com/exposr/exposr-server/commit/319d2947bda23dc241c4215bcf08b67410ab41da))
* update helm chart to support k8s native clustering mode ([6a5d148](https://github.com/exposr/exposr-server/commit/6a5d1485c788f1645cba0751d65a9a0573f02807))

### [0.7.1](https://github.com/exposr/exposr-server/compare/v0.7.0...v0.7.1) (2023-03-16)


### Bug Fixes

* **api:** only try to create tunnels on PUT requests ([e7c52f4](https://github.com/exposr/exposr-server/commit/e7c52f4a3a863dd4a45460f02ea615be13276a74))
* **config:** allow argv to be passed in to the constructor ([5e43522](https://github.com/exposr/exposr-server/commit/5e435228914b304f53a12744c04e119bb6c0a939))
* delete the static instance reference ([d048674](https://github.com/exposr/exposr-server/commit/d04867498cf69a555b2a4bbdcf30512634814b0a))
* **eventbus:** properly destroy the EventBusService ([e8f6e4b](https://github.com/exposr/exposr-server/commit/e8f6e4b8d5e2713d454709254be28fd82f9b41cf))
* **eventbus:** remove listener on timeout ([c9f6d40](https://github.com/exposr/exposr-server/commit/c9f6d40e8c296403b4f8c13767a67c28707beee3))
* **eventbus:** return message when using waitFor ([1395c1f](https://github.com/exposr/exposr-server/commit/1395c1fa70c4101fd74050cf073e0900c955ebfd))
* **eventbus:** update redis eventbus ([f072cb1](https://github.com/exposr/exposr-server/commit/f072cb1cbf55f13411901f2858f8c4e8d39f9266))
* **ingress:** delete instance reference on destroy ([c807a1e](https://github.com/exposr/exposr-server/commit/c807a1edd8eba0d051e6096f96310bdbf48e1bfb))
* **listener:** properly reference count listeners ([978e76b](https://github.com/exposr/exposr-server/commit/978e76b62cf59cc596f67ed2d2845d34f16d87e6))
* **lock:** overhaul lockservice ([5feb2cc](https://github.com/exposr/exposr-server/commit/5feb2cc1f3505acc5f0caab2f779957386a6ad6b))
* **memory-eventbus:** add missing destroy method ([820969a](https://github.com/exposr/exposr-server/commit/820969a273d4658567203fafd8dcefa048967508))
* print origin of exception when logging uncaught exceptions ([bf2c582](https://github.com/exposr/exposr-server/commit/bf2c582081ac9dbce961b2dc45d8837fb36c3b3c))
* remove non-printable characters ([0a7c9aa](https://github.com/exposr/exposr-server/commit/0a7c9aa630f4aba6b6a8621cd8372d63be0b9b62))
* **ssh:** allow access token to be pass as ssh password ([eb52708](https://github.com/exposr/exposr-server/commit/eb52708c2b84e78bb222acdb2217245e3cc1ab33))
* **ssh:** fix typo ([b39deef](https://github.com/exposr/exposr-server/commit/b39deefe9eb3c71b0835f21276593e38e04cea57))
* **storage:** add missing promise await ([7778ca7](https://github.com/exposr/exposr-server/commit/7778ca7e9b58c3dceed594ed66f8cfb696d47216))
* **storage:** check if lock is still held before commit ([97c068e](https://github.com/exposr/exposr-server/commit/97c068ec830d7d77873b4e63bb962868dce6cd9b))
* **storage:** return the value of the delete operation ([8bfdfce](https://github.com/exposr/exposr-server/commit/8bfdfcee819f935fa877e5b681b3d0f7d71aabf6))
* **storage:** update list() to only return max count entries ([aa8f65c](https://github.com/exposr/exposr-server/commit/aa8f65c46c2cc7d3c92a951ce4b7ead2b1335f9c))
* **storage:** update redis storage provider ([13c6d4b](https://github.com/exposr/exposr-server/commit/13c6d4b7ab07482c62bdbb30c798becaebeb7f1f))
* **storage:** use allSettled during destroy ([100e01a](https://github.com/exposr/exposr-server/commit/100e01a6f315987fba3095f7ea63dfda07066991))
* trace output ([38731e8](https://github.com/exposr/exposr-server/commit/38731e81d4d300de93dab2519feb02255ca4066d))
* **tunnel-service:** delete instance reference on destroy ([95866ad](https://github.com/exposr/exposr-server/commit/95866ad92e3c98f49a108d318ef7d32d7134a9f6))
* use _isPermitted instead of equals check ([826c084](https://github.com/exposr/exposr-server/commit/826c0848feec81f61c0885c87613cf47a4250e56))
* use class private logging instances ([11fb0c6](https://github.com/exposr/exposr-server/commit/11fb0c6aabfcb023966de58ed28cf705e6ae0c01))

## [0.7.0](https://github.com/exposr/exposr-server/compare/v0.6.0...v0.7.0) (2022-03-10)


### Bug Fixes

* fix the ssh transport when target hostname is set through bindaddr ([8c5740a](https://github.com/exposr/exposr-server/commit/8c5740a4bfbb895ff27af1b7fd5ee6e469b3f708))

## [0.6.0](https://github.com/exposr/exposr-server/compare/v0.5.1...v0.6.0) (2022-03-01)


### ⚠ BREAKING CHANGES

* API property upstream is now called target

* rename upstream to target ([8c43783](https://github.com/exposr/exposr-server/commit/8c437837666684604b5453e68415ce417946af97))

### [0.5.1](https://github.com/exposr/exposr-server/compare/v0.5.0...v0.5.1) (2022-02-27)


### Bug Fixes

* **helm:** fix wrong port name for admin api ([e41c19b](https://github.com/exposr/exposr-server/commit/e41c19bc1fe336740b5fd7fe2538218f7f5486bf))

## [0.5.0](https://github.com/exposr/exposr-server/compare/v0.4.4...v0.5.0) (2022-02-27)


### ⚠ BREAKING CHANGES

* **admin-api:** move resources under v1/admin
* **ws-transport:** change the ws transport endpoint
* non-backwards compatible tunnel API

### Features

* add administrative account disabling ([6cd6f9a](https://github.com/exposr/exposr-server/commit/6cd6f9acce1ae52c3f41bb623d7dc5043a3dd9c8))
* add graceful shutdown timeout ([ec4b07e](https://github.com/exposr/exposr-server/commit/ec4b07eb594f9c1b900f5473d80e2c176082936e))
* **admin-api:** add API for listing/reading and deleting tunnels ([f06a247](https://github.com/exposr/exposr-server/commit/f06a2477033e998bf8469efe4b685a1b7a2a6578))
* **admin-api:** add endpoint to list accounts ([e5ab4ef](https://github.com/exposr/exposr-server/commit/e5ab4ef94d9f6e929183bd2503d0a5136f53274d))
* **admin-api:** add verbose flag to account list API ([8f72444](https://github.com/exposr/exposr-server/commit/8f72444c4996845be8fcbac8a95cd9239456959c))
* **admin-api:** expose account details ([b720320](https://github.com/exposr/exposr-server/commit/b72032038e1042f9db45e689985027212f9f75c2))
* **admin-api:** implement account deletion ([22da260](https://github.com/exposr/exposr-server/commit/22da26015540933290205c34149682fa905cc78f))
* force quit on second SIGTERM/SIGINT ([6ff89e6](https://github.com/exposr/exposr-server/commit/6ff89e6153147f96aa6b3c67c8ef8c140657465d))
* **helm:** only expose admin api through the admin ingress ([3172fd6](https://github.com/exposr/exposr-server/commit/3172fd64e9dc017508b99eecbd9e15988e540d77))
* split admin service and admin api into separate controllers ([f780fab](https://github.com/exposr/exposr-server/commit/f780fab75d2a8eeda0dd4757628bbbc65abfe3ac))
* **storage:** add support for batch get/read ([888b638](https://github.com/exposr/exposr-server/commit/888b638bf8a335da469b326a810e60d0fd58f7a4))
* **tunnel-service:** add cursor based listing of tunnels ([7066a6d](https://github.com/exposr/exposr-server/commit/7066a6d27a9bbde054b3de2263e662d10a7942e9))


### Bug Fixes

* **admin-api:** move resources under v1/admin ([0b9298a](https://github.com/exposr/exposr-server/commit/0b9298a126f805929485f07d470bfcbdb28768f9))
* allow API controllers to properly run on the same port ([6c6f78f](https://github.com/exposr/exposr-server/commit/6c6f78ff1ede6e6a7a279de83ab86f8ceb8b49bd))
* **altname-service:** default to empty array ([32839c1](https://github.com/exposr/exposr-server/commit/32839c17c19d5349039bdddd52e782d9e9d5e14b))
* **api-controller:** allow unsetting values ([57c4d6b](https://github.com/exposr/exposr-server/commit/57c4d6be2d7b8af0dc7d950d69be818232b2c0dc))
* consider undefined as [] when setting new altnames ([2f1faeb](https://github.com/exposr/exposr-server/commit/2f1faeb2b586c9de0cd4f4a94f9ca373c4f6788c))
* **eventbus:** call ready callback in next tick ([650436b](https://github.com/exposr/exposr-server/commit/650436ba9dae53694dacba836a0f53abaef05ccd))
* **helm:** explicitly set http ingress port ([99411fb](https://github.com/exposr/exposr-server/commit/99411fb4ed2484863520b061112631eff1a4e9cd))
* **http-ingress:** destroy altnameservice during shutdown ([bd3322f](https://github.com/exposr/exposr-server/commit/bd3322f939682749d7fa8f7accb30af2fe602218))
* **http-listener:** add proper lifecycle handling to http listener ([c481627](https://github.com/exposr/exposr-server/commit/c4816272f159b0f54684a0d44f1bbc1d8098898c))
* **http-listener:** wrap callback in try/catch ([d0a4104](https://github.com/exposr/exposr-server/commit/d0a410484e06d31c2854bf4879729e155b25fe2d))
* move out service references in ORM classes ([657d56f](https://github.com/exposr/exposr-server/commit/657d56fc8c7ea52a6c91e4ae4c57deaefc3bdb47))
* **node-socket:** destroy tunnelservice reference on destroy ([027ff23](https://github.com/exposr/exposr-server/commit/027ff236200cb5d11850583858d9f6a1bb0ac471))
* share koa instance across controllers using the same listener ([a6c43f3](https://github.com/exposr/exposr-server/commit/a6c43f3e5e5ed9cee0934aa18437c833cc5f6a4a))
* shutdown API controllers before transport and ingress ([caeac37](https://github.com/exposr/exposr-server/commit/caeac375436636db86f3f8aaa9f1b2faca71d66d))
* **sni-ingress:** implement proper graceful destroy ([397eed1](https://github.com/exposr/exposr-server/commit/397eed18b204fa41148cc8ae06d281e06d89c5f5))
* **ssh-endpoint:** implement destroy ([97b79b4](https://github.com/exposr/exposr-server/commit/97b79b4d1647daa4f069cec9b99e6de9316cb558))
* **ssh-transport:** destroy tunnelservice reference on destroy ([27606cc](https://github.com/exposr/exposr-server/commit/27606cc1b47c9139b8a667f7940c9c490d10b059))
* **storage:** don't multi-query storage layer if array of keys is empty ([af3ef90](https://github.com/exposr/exposr-server/commit/af3ef90b4dfe533f3ff587c92d5edbd305ae2548))
* **transport-service:** add reference counting ([1cabede](https://github.com/exposr/exposr-server/commit/1cabedef093038f37318898cda2bd85e0d484601))
* **tunnel-service:** add reference counting to handle lifecycle ([76c7e65](https://github.com/exposr/exposr-server/commit/76c7e658d504817ce4a7d78bc7d4c9c6eca36c90))
* **tunnel-service:** disconnect tunnels on shutdown ([4fcfcc9](https://github.com/exposr/exposr-server/commit/4fcfcc96a2718b459f1965c3bd212aa28d1fc73b))
* **tunnel-service:** fix broken permission check ([9bdd3fe](https://github.com/exposr/exposr-server/commit/9bdd3fe0da8d393cc98f87fb2493d8b0968115b7))
* **tunnel:** create clone method ([792344d](https://github.com/exposr/exposr-server/commit/792344d2647542593206c63503117aab215c5522))
* update helm ingress template to use networking.k8s.io/v1 ([1aea5ff](https://github.com/exposr/exposr-server/commit/1aea5ff3a7d80836f6f0036255e1f653154eb32c))
* wait for api controller to become ready at startup ([ad44e46](https://github.com/exposr/exposr-server/commit/ad44e4625e5305845560c9c5584e318dcfb6790a))
* wait for transport to become ready during startup ([8a3e2e9](https://github.com/exposr/exposr-server/commit/8a3e2e9df467bbe3c8aa15a4548a4ee32c4bb6fa))


* change endpoints to transport in tunnel API ([37029fd](https://github.com/exposr/exposr-server/commit/37029fd21ec1cd25d77a2d8280e9e2a16835aa50))
* **ws-transport:** change the ws transport endpoint ([36274bd](https://github.com/exposr/exposr-server/commit/36274bd6b83389321175b5ad1f7601f67ccc5081))

### [0.4.4](https://github.com/exposr/exposr-server/compare/v0.4.3...v0.4.4) (2021-10-01)

### [0.4.3](https://github.com/exposr/exposr-server/compare/v0.4.2...v0.4.3) (2021-08-18)


### Bug Fixes

* add missing return in storage updates ([7dd04ab](https://github.com/exposr/exposr-server/commit/7dd04abebe6a6ed204f6236090ddbbe1a90b2a9c))
* **helm:** really fix service name and resource name for admin ingress ([98b8371](https://github.com/exposr/exposr-server/commit/98b83715f6473adb7abb41dce24539c3a8459261))

### [0.4.2](https://github.com/exposr/exposr-server/compare/v0.4.1...v0.4.2) (2021-08-18)


### Bug Fixes

* **helm:** fix service name for admin ingress ([1683730](https://github.com/exposr/exposr-server/commit/1683730d111a1512711f564f962d0694e8817b56))

### [0.4.1](https://github.com/exposr/exposr-server/compare/v0.4.0...v0.4.1) (2021-08-18)


### Bug Fixes

* **helm:** wrong resource kind ([7bc06d9](https://github.com/exposr/exposr-server/commit/7bc06d9f8e9791720f7e7688d215c7f10a443ec3))

## [0.4.0](https://github.com/exposr/exposr-server/compare/v0.3.1...v0.4.0) (2021-08-18)


### Features

* use dashes as account number separator ([5b87fce](https://github.com/exposr/exposr-server/commit/5b87fce33ea6d61bced04e2e84eec53ad14eb5b5))
* **config:** group configuration options ([11a5ea8](https://github.com/exposr/exposr-server/commit/11a5ea891f0e33bc05719175a44278e522041c8e))
* **config:** smarter config parser ([30bf10e](https://github.com/exposr/exposr-server/commit/30bf10e8c9520497c555013b6fc36e7028882705))
* **http-ingress:** support for BYOD (bring-your-own-domain) ([5c0c707](https://github.com/exposr/exposr-server/commit/5c0c707c8759e6c3ff49fd97eec5cbfd3012e949))
* **sni-ingress:** add ingress-sni-host option ([d6bda57](https://github.com/exposr/exposr-server/commit/d6bda57fbd42ec421a1baae592c0197e5ddf5791))


### Bug Fixes

* **config:** let tests run without a command line config ([8aa8eff](https://github.com/exposr/exposr-server/commit/8aa8eff439a3c8b0c2e2d4df263fc363477135f5))
* **tunnel-service:** only refresh connection token on disconnect ([74c1cd9](https://github.com/exposr/exposr-server/commit/74c1cd9ef799c2b73074f062b194560b12f82152))
* improve error handling during startup ([4360904](https://github.com/exposr/exposr-server/commit/43609047e2fb884a9ad4b75ded10e63a1085b502))
* **sni-ingress:** add missing destroy() ([fb09ad2](https://github.com/exposr/exposr-server/commit/fb09ad25dacc85d1647b7640326a966aad4845fb))
* **ssh-endpoint:** use port from ssh-transport-host when constructing endpoint url ([18ad9f2](https://github.com/exposr/exposr-server/commit/18ad9f21238b0dc534e04bfb65dd14e0e5da022d))
* add a handler the uncaughtException event ([571b8c6](https://github.com/exposr/exposr-server/commit/571b8c6cd7d9637a2da209bf5037de7d705edb95))
* **ssh-transport:** use existing ingress urls ([cd8ad11](https://github.com/exposr/exposr-server/commit/cd8ad11a680e5c047b7dfb63d0c9d653e1c12269))

### [0.3.1](https://github.com/exposr/exposr-server/compare/v0.3.0...v0.3.1) (2021-08-15)


### Bug Fixes

* **helm:** add missing template for admin ingress ([e4f1024](https://github.com/exposr/exposr-server/commit/e4f1024719a3a197751a6cc10e0ee98391083e90))

## [0.3.0](https://github.com/exposr/exposr-server/compare/v0.2.0...v0.3.0) (2021-08-14)


### Features

* **config:** allow ssh host key to be passed base64 encoded ([98ef1d5](https://github.com/exposr/exposr-server/commit/98ef1d561341035cd9bffa23e7c44a9f798a8236))
* **helm:** update helm chart to support new features ([1110da6](https://github.com/exposr/exposr-server/commit/1110da67b39137dd15b2a685bec056c0addb9e31))
* **ingress:** add support for SNI ingress ([608ec03](https://github.com/exposr/exposr-server/commit/608ec03f7de8c0de3e8841d1ab36f586b6a6baed))


### Bug Fixes

* **config:** allow multi-value options to be passed as comma separated env. variables ([55a98df](https://github.com/exposr/exposr-server/commit/55a98dfeebd4b6ade6490b81d71ae94b2b63cdd0))

## [0.2.0](https://github.com/exposr/exposr-server/compare/v0.1.5...v0.2.0) (2021-07-23)


### Features

* add SSH as an alternative tunnel transport ([9e9a84e](https://github.com/exposr/exposr-server/commit/9e9a84e2a18efbde2f0304bcdf01ddf9b0a19266))
* return configured upstream url in tunnel api ([f8b09f7](https://github.com/exposr/exposr-server/commit/f8b09f7ad21a7b59a2a32521e5630a5d793f44e4))


### Bug Fixes

* **api-controller:** don't override existing configuration with undefined values ([3222f20](https://github.com/exposr/exposr-server/commit/3222f208f38040710d8b79bd5716391ade228774))
* **helm:** don't require api-url in helm configuration ([103afbc](https://github.com/exposr/exposr-server/commit/103afbc501e4f75e7c9e2f18263fee63fffde227))

### [0.1.5](https://github.com/exposr/exposr-server/compare/v0.1.4...v0.1.5) (2021-07-18)


### Bug Fixes

* **helm:** fix container image path ([46dacf4](https://github.com/exposr/exposr-server/commit/46dacf41a69104e1eb61fb54dfd2c1beb5ee5e79))

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
