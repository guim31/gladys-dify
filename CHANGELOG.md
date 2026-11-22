# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-22

### Added

- Scene action _Run a Dify workflow_: a workflow app run with inputs from the
  scene (`name=value` pairs or JSON); its answer, all its outputs, the app, the
  run time, the tokens and whether the answer was cut are handed to the next
  actions.
- Scene action _Send a message to Dify_: a message to a chatflow, a chat app,
  an agent or a text generator, in a conversation kept by name (even after a
  restart).
- Every failure shows in red with its reason; a run that outlives the wait is
  stopped in Dify.
- One device per Dify app: online, last run succeeded, its duration and tokens,
  last answer.
- Scene triggers _A Dify run failed_, _Dify is offline_ and _Dify is back
  online_.
- Dashboard widget "Dify": the server, the last run of each app, the latest
  answer.
- _Test the connection_ lists the apps and their kind.
- English, French, German and Spanish everywhere.

[Unreleased]: https://github.com/guim31/gladys-dify/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-dify/releases/tag/v1.0.0
