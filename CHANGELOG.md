# Changelog

## [0.1.3](https://github.com/politeauthority/timed-tabs/compare/v0.1.2...v0.1.3) (2026-09-13)


### Features

* a backup says which Timed Tabs wrote it ([4b43540](https://github.com/politeauthority/timed-tabs/commit/4b4354074032c07935f410756bf3dbb6f3375cbe))
* a beta badge in the header while Beta features is on ([a5a0505](https://github.com/politeauthority/timed-tabs/commit/a5a0505f020bcd7494ff9177582581e993a0c149))
* a Chrome dev target, and a dev hook Chrome can trigger ([2dabeb6](https://github.com/politeauthority/timed-tabs/commit/2dabeb63226267cb34d6c5fb3eb24f101c833ca8))
* a shorter settings page, and leads measured back from expiry ([9dc19d4](https://github.com/politeauthority/timed-tabs/commit/9dc19d48639755ef60f662440e3c2c11065197a9))
* a tally of what Timed Tabs has actually done ([de7ab71](https://github.com/politeauthority/timed-tabs/commit/de7ab713a8f2e236f3abcc031209cf76a78f5855))
* an all-time count of tabs killed that survives a clear and travels in backups ([1273f29](https://github.com/politeauthority/timed-tabs/commit/1273f292647888637d4602f40460723106ee1914))
* Backup and Diagnostics become pills on the Settings page ([d5c7bb8](https://github.com/politeauthority/timed-tabs/commit/d5c7bb814a16f643170a429cdd145cc59e1dbec1))
* beta feature switches hide until Beta features is on ([7ebfdef](https://github.com/politeauthority/timed-tabs/commit/7ebfdefd4ffb814e185fcc236a2e81827ebc63f0))
* **e2e:** count the scenarios as they run, in the log and the summary ([10dd726](https://github.com/politeauthority/timed-tabs/commit/10dd7262a42f0290e04f9e2fa3b54b2b106e5e77))
* **e2e:** run the scenarios in Chrome as well as Firefox ([6731495](https://github.com/politeauthority/timed-tabs/commit/67314959200dfa3863ab02a291d40f2ee5def31a))
* **e2e:** the full run tests the last four Chromes too, on the Chrome branch ([8d42cce](https://github.com/politeauthority/timed-tabs/commit/8d42ccedc4ed04b9a57b57cc25e69fa7ee27d5c4))
* feature flags get a pill of their own ([e042d20](https://github.com/politeauthority/timed-tabs/commit/e042d203f4df91636a7f02b57bed9d3f24f5867c))
* no fold on the popup's rules section when no rule matches ([e6f257d](https://github.com/politeauthority/timed-tabs/commit/e6f257d927ef2684983da9cba65eac67df2ce135))
* only manage the tabs a rule matches, and an empty clock for the rest ([c23ec1c](https://github.com/politeauthority/timed-tabs/commit/c23ec1ce047517b831676c362b415df07a382e25))
* rules have names, a page of their own and a test page; settings save on demand ([40e867a](https://github.com/politeauthority/timed-tabs/commit/40e867a54dab6da4de8dc7566ced706d76c3ba8b))
* settings toasts are on for everyone ([3705cbf](https://github.com/politeauthority/timed-tabs/commit/3705cbf40cf63158cdd6e4c676f76e25470716bf))
* settings toasts, a message saying whether a change landed ([ebfee34](https://github.com/politeauthority/timed-tabs/commit/ebfee34c6dac8aef413057807387b93662ce3f4c))
* the beta features note moves to the foot of the view ([3775f81](https://github.com/politeauthority/timed-tabs/commit/3775f81d48e1d1b0eb5741191ee5ebd6de4b8b22))
* the icon rests on a full ring, with the ring rendered at every position ([403f4a3](https://github.com/politeauthority/timed-tabs/commit/403f4a30f5f39899d7b849e86fb2941094d0d928))
* the new rules display becomes the Rules page ([4fa12dd](https://github.com/politeauthority/timed-tabs/commit/4fa12ddc35deef1ca06eb6c700ed2c04c832ffa4))
* the new rules display takes the Settings page's cues: emoji chips and headings, softer cards ([aaccc96](https://github.com/politeauthority/timed-tabs/commit/aaccc961b0e87aefdf86bf7fb6ee16be4ddb9d89))
* the rendered ring set ships inside the extension ([1a913de](https://github.com/politeauthority/timed-tabs/commit/1a913de4bf902db341e8e6c8def35e72d73edf3f))
* the ring fills its icon box, and the rendered set moves out of the package ([4b46ecf](https://github.com/politeauthority/timed-tabs/commit/4b46ecf44ecc80519bae830a4d532edef800b3b6))
* the statistics section goes behind a feature flag ([bdbaa29](https://github.com/politeauthority/timed-tabs/commit/bdbaa2970f0e7f38d3951154e9125fce68211841))
* the toolbar clock counts down, behind a flag ([cc35cab](https://github.com/politeauthority/timed-tabs/commit/cc35cab0cfc38250928489f9541a41492bb06a4c))
* the UI says which beta features are on ([697cc93](https://github.com/politeauthority/timed-tabs/commit/697cc9386c03381f8a93b2bd3a375cbd06436a01))


### Bug Fixes

* a private tab is counted in a notification, never named ([118d413](https://github.com/politeauthority/timed-tabs/commit/118d4135482a63b9078b1c24310775c282b27ea8))
* a tab closed in a private window is no longer written down ([39b07db](https://github.com/politeauthority/timed-tabs/commit/39b07db4b2cefe7d331c9e2edc698f441f926004))
* **dev:** the dev hook waits for its seed to be absorbed before opening windows ([3f5a992](https://github.com/politeauthority/timed-tabs/commit/3f5a99221cc9f70cd870f93bab7642e3a9c8af97))
* **dev:** the seed counts as absorbed when it has been, in Chrome too ([57f467c](https://github.com/politeauthority/timed-tabs/commit/57f467c9192411aefe4b754901548c7fa5e9cf05))
* drop the icon key above the tab list ([35673eb](https://github.com/politeauthority/timed-tabs/commit/35673ebef70a7661529885f936697ec7aa130023))
* every page view shares one width ([6efbed7](https://github.com/politeauthority/timed-tabs/commit/6efbed7f5d0abf83d59a13b27a178f02af726e8e))
* notifications announce themselves when switched on, and report their state ([5c4e52e](https://github.com/politeauthority/timed-tabs/commit/5c4e52e848980b8dbfc75e8806dac13b107db16f))
* page settings in the popup stop jumping, and the popup's sections fold per tab ([703eb19](https://github.com/politeauthority/timed-tabs/commit/703eb199c58d8803f557c9fc88372526bbb72ba0))
* tabs close when they expire ([accd7cc](https://github.com/politeauthority/timed-tabs/commit/accd7cc4275d719a66fbd663021b683ae6f609ee))
* the clock shows on pages where it is only paused ([d267f67](https://github.com/politeauthority/timed-tabs/commit/d267f670a3b24fc2800f2891d0fdf52c96848f7c))
* the toolbar clock reads correctly at every fill ([4153cb9](https://github.com/politeauthority/timed-tabs/commit/4153cb93197ef5ca082912bd68f1e04a1b8c6c50))
* the toolbar clock says nothing rather than the wrong thing ([58122e5](https://github.com/politeauthority/timed-tabs/commit/58122e54880ab2f08552a6ec16e995dc93a709a0))

## [0.1.2](https://github.com/politeauthority/timed-tabs/compare/v0.1.1...v0.1.2) (2026-09-11)


### Bug Fixes

* validate settings the same way from a backup and from storage, and keep ids unique ([8ce31bb](https://github.com/politeauthority/timed-tabs/commit/8ce31bb974ac8713d940fa496013d82094f5b291))

## [0.1.1](https://github.com/politeauthority/timed-tabs/compare/v0.1.0...v0.1.1) (2026-09-11)


### Features

* a rules list that can be read at a glance ([1294d0d](https://github.com/politeauthority/timed-tabs/commit/1294d0d04cc684662463c13a8ce351671c78aad1))
* draw the remaining time on the toolbar button ([b69c86c](https://github.com/politeauthority/timed-tabs/commit/b69c86ccce00fab6da66823fa40bca826352e36f))
* page settings lists only what changed on this page ([ff16d1b](https://github.com/politeauthority/timed-tabs/commit/ff16d1b64d2a4a03c0c1a1b501f33067473e3671))
* put the new rules display behind a flag ([63d96d8](https://github.com/politeauthority/timed-tabs/commit/63d96d87bf514f7e0018bdd6d60bd4da05e68050))
* redraw the toolbar mark as a dial, generated from one source ([da9f4ee](https://github.com/politeauthority/timed-tabs/commit/da9f4ee79b62cf7650da7c7c45ad5c848512715e))


### Bug Fixes

* background correctness: linear wildcard matching, working per-tab indicator overrides, and expiry that recovers ([e81db36](https://github.com/politeauthority/timed-tabs/commit/e81db36b95d96396011e96c4fc3ed6972b9fb69b))
* compare icon pixels, not the bytes a particular zlib produced ([97eec1e](https://github.com/politeauthority/timed-tabs/commit/97eec1eecdd6a8bc2984b5780195c530f3198390))
* popup reads the tab's effective settings, and the UI stops rebuilding under the cursor ([ac59efb](https://github.com/politeauthority/timed-tabs/commit/ac59efbc022463d76465a920f009964e971dcc7c))
* require Firefox 142, where data collection permissions landed ([ca20cb5](https://github.com/politeauthority/timed-tabs/commit/ca20cb53929591af0af30751c36d6d239966701e))
* the "this tab" marker should not outshout the panel ([cd25f9c](https://github.com/politeauthority/timed-tabs/commit/cd25f9c36a55097dfd13abed91bb046766d85897))

## 0.1.0 (2026-09-11)


* force release v0.1.0 ([7e298ae](https://github.com/politeauthority/timed-tabs/commit/7e298aeb5d6e8a574c3df6def9e9d7c64ad9e14a))


### Features

* a master switch for tab management ([bb7b105](https://github.com/politeauthority/timed-tabs/commit/bb7b105dbbc34b98343112b9387c791fe9378d97))
* a mini-ui-page-settings flag, dependent on beta features, with live flag changes ([50eeb47](https://github.com/politeauthority/timed-tabs/commit/50eeb47f0ac666f96c1875e1b133a79e1ecd620c))
* a source checkout shows its version with -dev ([a1b9f95](https://github.com/politeauthority/timed-tabs/commit/a1b9f9562408a689237da029ac02d41f0cb1faa0))
* backup gets its own page, and notifications their own pill ([fd1f07a](https://github.com/politeauthority/timed-tabs/commit/fd1f07a90c2f0e4bfa093725257224f6f0964305))
* beta releases as snapshots of main, with a badge in the UI ([8946d56](https://github.com/politeauthority/timed-tabs/commit/8946d56dd688f52b565cfb92e777cd65427a3d71))
* Checking back in for now ([11c509c](https://github.com/politeauthority/timed-tabs/commit/11c509c5f31dfb63707ba197882eaaba705c5a64))
* drop the mini UI's bottom navigation ([6670fb9](https://github.com/politeauthority/timed-tabs/commit/6670fb921026a738bec0f7ac4e5bb41be798b59c))
* feature flags, and put Page settings behind one ([7b7575d](https://github.com/politeauthority/timed-tabs/commit/7b7575d86d4eda3e6be65ae227c971aa4ab2ede8))
* first commit ([c229a52](https://github.com/politeauthority/timed-tabs/commit/c229a52be0268eec66f08a9196be226f38eae5a4))
* flash indicators when a tab is about to expire ([9766b0e](https://github.com/politeauthority/timed-tabs/commit/9766b0e179a4961ca567df33b0437fd2e93de51d))
* icon-only restart and snooze, with a zZ mark ([8d7a8af](https://github.com/politeauthority/timed-tabs/commit/8d7a8afcb5822a9a10a165ce3ec57bd199ed7795))
* Initial code! ([ea6f548](https://github.com/politeauthority/timed-tabs/commit/ea6f548c2454b64283afa4d459fa5d4c1782c2cf))
* Initial code! - [#1](https://github.com/politeauthority/timed-tabs/issues/1) ([ea6f548](https://github.com/politeauthority/timed-tabs/commit/ea6f548c2454b64283afa4d459fa5d4c1782c2cf))
* link the repository from the UI and reword the full-page button ([67dd1ec](https://github.com/politeauthority/timed-tabs/commit/67dd1ecff70475cf26741cb68df7e3f4c96f4c88))
* LOTs of improvements ([226a360](https://github.com/politeauthority/timed-tabs/commit/226a3602c29f933d2ab8edef07d86d099372b6ee))
* make a tab's remaining time directly adjustable ([a5b5d4f](https://github.com/politeauthority/timed-tabs/commit/a5b5d4f50ffb6d66a42ed2c31a2fc779793b5904))
* notify when a tab is closed by expiry ([311696f](https://github.com/politeauthority/timed-tabs/commit/311696fc0b9ed425c0a934f3894c731fa240c74d))
* order the open-tabs list by time left ([c1acaca](https://github.com/politeauthority/timed-tabs/commit/c1acaca85aa6d4810bd639a95d0b293f44742556))
* page settings in the popup ([cadd462](https://github.com/politeauthority/timed-tabs/commit/cadd462928df0b86a0db370b2a8345395cf9a581))
* page settings is one line per setting in the popup ([c3cbf84](https://github.com/politeauthority/timed-tabs/commit/c3cbf840411e3ac8118eb335a0366566b06582d2))
* popup tidy-up: Never expire on the action row, a rule count, an icon edit button ([ea92d25](https://github.com/politeauthority/timed-tabs/commit/ea92d25c3c568dee1a2e40f364852790c25ab781))
* put "rules for this page" back in the popup ([8ba0a32](https://github.com/politeauthority/timed-tabs/commit/8ba0a32938c06399283eb09d72e507f698c834e1))
* rules and single tabs can override how a tab is painted ([b407e2a](https://github.com/politeauthority/timed-tabs/commit/b407e2a74c8e9e785d09ddc55f7af82dd416483d))
* rules page polish ([07a9827](https://github.com/politeauthority/timed-tabs/commit/07a982799b4d1c91d81cb339c1f70f067e243ed9))
* settings groups become pill tabs, with emoji across the pages ([0bdb3cc](https://github.com/politeauthority/timed-tabs/commit/0bdb3ccd32e3626aeda300b95b6947e97fb4d422))
* show restart-on-focus in the popup without expanding ([716b5e4](https://github.com/politeauthority/timed-tabs/commit/716b5e403046ad99e68303c1e2d377084bdd760b))
* show the running version in the UI, with optional build tags ([fe9d371](https://github.com/politeauthority/timed-tabs/commit/fe9d371d6597b4c83297b158deb4f9925cda8461))
* site groups, behind a feature flag ([6c8b938](https://github.com/politeauthority/timed-tabs/commit/6c8b938c3bdfdb4c6474b3ec30bfc19c3b487ac8))
* unified visual language for the panel ([007de47](https://github.com/politeauthority/timed-tabs/commit/007de4748075b501b5381a503a35cdb7729f6ad3))


### Bug Fixes

* appearance is set by rules only, with globals as the default ([fc32346](https://github.com/politeauthority/timed-tabs/commit/fc323462f4d8e7117f3abea7eb284acb62979f67))
* e2e: site groups now need the beta-features flag too ([31637bb](https://github.com/politeauthority/timed-tabs/commit/31637bb194ae39ebf5111525e6864fecaafd033d))
* e2e: time scenarios from the extension's first log line, and let navigate wait for the page ([3407c4f](https://github.com/politeauthority/timed-tabs/commit/3407c4fe4f6e5627e766a1bb2d2b993f13523e2f))
* keep the gh action's sparse checkout out of the build tree ([08f5959](https://github.com/politeauthority/timed-tabs/commit/08f59592628fbb02c8b025bcc9c6c12d86058ab8))
* mini UI footer is the version alone, and cannot scroll sideways ([8c7e3ad](https://github.com/politeauthority/timed-tabs/commit/8c7e3ad156f92c28fb2a07adf45e4fdc21b1f37d))
* page settings rows show their value, whatever sets it ([d0d76ec](https://github.com/politeauthority/timed-tabs/commit/d0d76ecd2cfc083f30bd0a6d81b469e76e21b1c6))
* page settings speaks about this tab, not matching tabs ([2607b3f](https://github.com/politeauthority/timed-tabs/commit/2607b3fb883d23dc18608aafee34d047796a3cad))
* point task run WT= at the worktrees directory ([b379b93](https://github.com/politeauthority/timed-tabs/commit/b379b93a73925bfeb489fe6869898eccafbcf4bd))
* put gh on the self-hosted runner before the release jobs use it ([99f30b0](https://github.com/politeauthority/timed-tabs/commit/99f30b02945d5e66eaf5c3d0357cb66512d632c8))
* recently expired list keeps the site's icon and groups repeats ([51980cc](https://github.com/politeauthority/timed-tabs/commit/51980cc5c9e73cbc6a69e28b8d6d75236f7e4610))
* regenerate lockfile with platform bindings, raise minimum Firefox to 140 (Android 142) ([f9b25b5](https://github.com/politeauthority/timed-tabs/commit/f9b25b5acf68d69518b99002e79a678798543550))
* set gh up from the workflow's own ref, not the tree it builds ([ee0f927](https://github.com/politeauthority/timed-tabs/commit/ee0f92783e4583112a68374b40e364e7c305ab19))
* site groups needs beta features on, like every other beta feature ([c22665a](https://github.com/politeauthority/timed-tabs/commit/c22665a71c9f38766a62448cfbfb7367c7088b1f))
* tell gh which repo to act on in the auto-merge job ([e8e4fdf](https://github.com/politeauthority/timed-tabs/commit/e8e4fdfed94e496c15c7c2352c5433c47c2dde1a))
* the appearance e2e scenario needs beta features on ([8107a0e](https://github.com/politeauthority/timed-tabs/commit/8107a0e1c8feebd03b12bb5e3dd4b347d979d1a0))


### Dependencies

* bump the npm-deps group with 4 updates ([3f38fb1](https://github.com/politeauthority/timed-tabs/commit/3f38fb1f92cd67ece06823fcde7b452668db83a0))

## Changelog
