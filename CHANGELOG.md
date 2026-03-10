# Changelog

## [0.4.1](https://github.com/matantsach/copilot-agent-teams/compare/copilot-agent-teams-v0.4.0...copilot-agent-teams-v0.4.1) (2026-03-10)


### Bug Fixes

* remove COPILOT_PLUGIN_ROOT and make worktrees optional ([#24](https://github.com/matantsach/copilot-agent-teams/issues/24)) ([015a099](https://github.com/matantsach/copilot-agent-teams/commit/015a099608fe190e5399f7aca20dc37a59daf05f))

## [0.4.0](https://github.com/matantsach/copilot-agent-teams/compare/copilot-agent-teams-v0.3.2...copilot-agent-teams-v0.4.0) (2026-03-10)


### Features

* main session orchestrator with peer communication ([#22](https://github.com/matantsach/copilot-agent-teams/issues/22)) ([c5d3a47](https://github.com/matantsach/copilot-agent-teams/commit/c5d3a472b660005eb6b393b5405dd86ed66fdb1a))

## [0.3.2](https://github.com/matantsach/copilot-agent-teams/compare/copilot-agent-teams-v0.3.1...copilot-agent-teams-v0.3.2) (2026-03-10)


### Bug Fixes

* revert .mcp.json to relative path ([7537fd9](https://github.com/matantsach/copilot-agent-teams/commit/7537fd907ed726123b715c34d0b934760876e2de))
* revert .mcp.json to relative path ([57f793c](https://github.com/matantsach/copilot-agent-teams/commit/57f793c4707294277db48c01846a326d3db054a5))

## [0.3.1](https://github.com/matantsach/copilot-agent-teams/compare/copilot-agent-teams-v0.3.0...copilot-agent-teams-v0.3.1) (2026-03-10)


### Bug Fixes

* use ${COPILOT_PLUGIN_ROOT} for all script and binary paths ([e2f3225](https://github.com/matantsach/copilot-agent-teams/commit/e2f3225d9092f9d3d49d7374a3a9bf854d3889c1))
* use ${COPILOT_PLUGIN_ROOT} for all script and binary paths ([88c2738](https://github.com/matantsach/copilot-agent-teams/commit/88c2738036d17dacfa3d9ace32e68019e8ed530c))

## [0.3.0](https://github.com/matantsach/copilot-agent-teams/compare/copilot-agent-teams-v0.2.1...copilot-agent-teams-v0.3.0) (2026-03-10)


### Features

* add /team-start, /team-status, /team-stop skills ([44e2a45](https://github.com/matantsach/copilot-agent-teams/commit/44e2a4526dd6799583662ad204c0592ff0e5a6f0))
* add conditional hooks — silent when no active teams ([536a00a](https://github.com/matantsach/copilot-agent-teams/commit/536a00a3b445929c2fa45e778c752e3803539ae5))
* add countUnread DB method for non-consuming message count ([d9d2975](https://github.com/matantsach/copilot-agent-teams/commit/d9d2975d5e828c90a2b1b7825577888d471e27d3))
* add git worktree isolation per teammate ([a1c9f01](https://github.com/matantsach/copilot-agent-teams/commit/a1c9f015c83badc6fa6b2a84eff746cdb9563fe6))
* add git worktree isolation per teammate (closes [#3](https://github.com/matantsach/copilot-agent-teams/issues/3)) ([d09578e](https://github.com/matantsach/copilot-agent-teams/commit/d09578ee61a67c89472a35e48ab0f61b3fce3814))
* add human review checkpoint with approve/reject workflow ([#8](https://github.com/matantsach/copilot-agent-teams/issues/8)) ([2665c39](https://github.com/matantsach/copilot-agent-teams/commit/2665c39c78148b6524a00d48a533440598857fe1))
* add MCP server entry point (server.ts factory + index.ts main) ([174b9a6](https://github.com/matantsach/copilot-agent-teams/commit/174b9a6f244316184a8c9b005b4615b8f8c16555))
* add monitor_teammates and steer_teammate MCP tools ([cad7572](https://github.com/matantsach/copilot-agent-teams/commit/cad75728e100d9930232b89b68a73003bcdabc4d))
* add observability with duration tracking and audit log ([#10](https://github.com/matantsach/copilot-agent-teams/issues/10)) ([684a2af](https://github.com/matantsach/copilot-agent-teams/commit/684a2afe26997d523e4485162cae9eabd442dc85))
* add shared types for teams, tasks, messages, members ([e5555b7](https://github.com/matantsach/copilot-agent-teams/commit/e5555b77c2c73df0aef559c315de117094f81ae2))
* add steerTeammate atomic DB method ([d14f9bf](https://github.com/matantsach/copilot-agent-teams/commit/d14f9bf2868bd3d9bb1714ba948610f5198dfee1))
* add team-lead and teammate agent definitions ([b72a729](https://github.com/matantsach/copilot-agent-teams/commit/b72a72966ae45e43cc86f36deb545939294d64f5))
* add tmux-based teammate spawning with graceful fallback ([f4fcf61](https://github.com/matantsach/copilot-agent-teams/commit/f4fcf61475b3dec06bccf2799565ae853ee27447))
* implement messaging tools — recipient validation, broadcast, atomic read-mark ([5d14b95](https://github.com/matantsach/copilot-agent-teams/commit/5d14b95b79febe6d90b3611a57cab251d049cdb8))
* implement task tools — state transitions, reassign, result required ([7b839c0](https://github.com/matantsach/copilot-agent-teams/commit/7b839c0dd5116595b25e231ff1a95189e85036d4))
* implement team tools with MCP tests — idempotent registration, countTasks ([6b53555](https://github.com/matantsach/copilot-agent-teams/commit/6b535558603a598190411753c333e6eb0ffc1b81))
* implement TeamDB with WASM SQLite — atomic claims, blocker validation, auto-unblock ([9a30ad7](https://github.com/matantsach/copilot-agent-teams/commit/9a30ad7c4f43feafe8fda3dc97509011dfdeb046))


### Bug Fixes

* add active-team check to reassign_task, extract shared agentIdSchema ([ac17a13](https://github.com/matantsach/copilot-agent-teams/commit/ac17a13583f72904444f830dfdc277c1a82c3da9))
* address final code review findings ([51831f4](https://github.com/matantsach/copilot-agent-teams/commit/51831f41da0156fc6d79d6cfb5f9d79a9cb7bbaf))
* address review findings for worktree isolation PR ([f381dd9](https://github.com/matantsach/copilot-agent-teams/commit/f381dd9a61ec0e4c7003b53556f0927c072b123f))
* correct GitHub username casing in repo URL and install command ([00b766b](https://github.com/matantsach/copilot-agent-teams/commit/00b766b026eb43ffb8e1056d51db19195b45c745))
* detect tmux via process tree when $TMUX env var is stripped ([16e1666](https://github.com/matantsach/copilot-agent-teams/commit/16e166682bf418789bc21770ca4bb36171e27d0b))
* detect tmux via process tree when env var is stripped ([21eeff1](https://github.com/matantsach/copilot-agent-teams/commit/21eeff19bc03cfa245995dab99211baec5aa534c))
* detect tmux via server socket instead of process tree ([1878e85](https://github.com/matantsach/copilot-agent-teams/commit/1878e85deaa4c0b52f67098c0b807b065850b656))
* detect tmux via server socket instead of process tree ([e95a32e](https://github.com/matantsach/copilot-agent-teams/commit/e95a32ec6385fde62e2e7feb5111e689aa81fe71))
* improve error handling in readProgressFile and add missing tests ([ce072fe](https://github.com/matantsach/copilot-agent-teams/commit/ce072fe89eb4a8ad42de6c778ff3a0a40589febb))
* improve skills and agent definitions per Copilot CLI best practices ([07361c2](https://github.com/matantsach/copilot-agent-teams/commit/07361c2bb4f1155d1b213761fcf05aecd905f148))
* parameterize steer_teammate caller and fix timestamp consistency ([dc65ca0](https://github.com/matantsach/copilot-agent-teams/commit/dc65ca00dc8c57760c8c9dd2918b1cbc91dd3784))
* rebuild dist/ without cross-worktree contamination ([5d3fe60](https://github.com/matantsach/copilot-agent-teams/commit/5d3fe60634c710b7f7abcefe16cd3fe5119d7605))
* remove release-type override so release-please reads config file ([9221e63](https://github.com/matantsach/copilot-agent-teams/commit/9221e63bf9331941af4c786e804ddadc1dbd0a39))


### CI

* add GitHub Actions CI, release workflow, and project infrastructure ([ff77461](https://github.com/matantsach/copilot-agent-teams/commit/ff77461d45a84a1f042a7ba73d9f58d0f48e9d63))
* add plugin.json to release-please extra-files and sync manifest ([d591d89](https://github.com/matantsach/copilot-agent-teams/commit/d591d898934fcd9a38ae9c8b1da5de2e2a6c6f82))
* add release-please automation, update username to mtsach ([bfa9880](https://github.com/matantsach/copilot-agent-teams/commit/bfa9880712f53470b14cf619e6991b3e1a898897))


### Documentation

* add implementation plan — 14 tasks, TDD, bite-sized steps ([21b1d3d](https://github.com/matantsach/copilot-agent-teams/commit/21b1d3d92e9bc76729a6718bfe42c4f726fb374e))
* add lead monitoring and steering design and implementation plan ([afacbbf](https://github.com/matantsach/copilot-agent-teams/commit/afacbbf84893df6f85a1f90b37dfe52fe02a565e))
* add README ([5073c01](https://github.com/matantsach/copilot-agent-teams/commit/5073c01347f76fb27e07b0177442b8bdaae3d86b))
* add tmux-based teammate spawning design ([4e31477](https://github.com/matantsach/copilot-agent-teams/commit/4e314772eca3c47165fa248ea554ff33c13c7f62))
* final fixes — lead-only enforcement, active-team checks, CJS package type ([3cf8f6b](https://github.com/matantsach/copilot-agent-teams/commit/3cf8f6bc3ae74c8b1de25c6cd7d1b3ba46325617))
* rewrite design and implementation plan — fix all critical/high issues ([5f1791c](https://github.com/matantsach/copilot-agent-teams/commit/5f1791c9583acbfeccf51ee8cc43e71662cc97d3))
* round 3 fixes — WASM SQLite, conditional hooks, pre-assignment guards ([33cc5b5](https://github.com/matantsach/copilot-agent-teams/commit/33cc5b55a7c0ebc85e66824376de0a53b3b4e1bf))
* round 4 fixes — CJS format, broadcast expansion, simplified getMessages ([54df951](https://github.com/matantsach/copilot-agent-teams/commit/54df951436ceb652c2689489d68e119ba8a2873c))
* round 5 fixes — state transitions, reassign_task, full tool code, hook tests ([9430ce1](https://github.com/matantsach/copilot-agent-teams/commit/9430ce15ddccb1274bc4ace875dd68ce290d2590))
* update agent prompts with progress reporting and monitoring instructions ([1e9c968](https://github.com/matantsach/copilot-agent-teams/commit/1e9c968cd24718b9ba848d511046aeb9e6a5d347))


### Miscellaneous

* add built dist/ for plugin distribution ([d591f69](https://github.com/matantsach/copilot-agent-teams/commit/d591f6979060f2daba9aa4a53b266f1931cbde0a))
* add open source essentials — LICENSE, CONTRIBUTING, improved README ([cf573ae](https://github.com/matantsach/copilot-agent-teams/commit/cf573aeabb9918159cde0e26082e1e60a7fd61a8))
* add plugin manifest, MCP server config, and hooks stub ([675a989](https://github.com/matantsach/copilot-agent-teams/commit/675a98953d4b147aa151a23f858f19f06c9fb85a))
* bump version to 0.2.1 ([868ccb1](https://github.com/matantsach/copilot-agent-teams/commit/868ccb1310c5e017d3b10212d79a72363478ee86))
* plugin marketplace metadata and cross-platform hooks ([#14](https://github.com/matantsach/copilot-agent-teams/issues/14)) ([f7ad319](https://github.com/matantsach/copilot-agent-teams/commit/f7ad31915a657d82de8224e095a344927b6907b4))
* rebuild dist with monitoring tools ([afb0cd2](https://github.com/matantsach/copilot-agent-teams/commit/afb0cd275d4aa7753ebf295e34e51c05a2ed64d3))
* scaffold project with TypeScript, esbuild, WASM SQLite, MCP SDK ([da4cd2c](https://github.com/matantsach/copilot-agent-teams/commit/da4cd2c93c5ed096004b6157c4a047cfd3536d91))
* update all references to matantsach username ([18267b9](https://github.com/matantsach/copilot-agent-teams/commit/18267b9ac1792137668f2b5cebd9238a0cc0e7e4))
