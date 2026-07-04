# Changelog

## [v1.2.1] - 2026-07-04
### Added
- Popup button to pause and resume monloader's downloads.

## [v1.2.0] - 2026-07-01
This update include a breaking change with the monloader pairing mechanism. Update monloader to >v1.2.0 and use the pairing mechanism.

### Added
- One-click "connect to monloader": pair and approve in monloader's settings.
### Changed
- Changing the monloader URL now clears the stored token, so you re-pair for the new instance.
### Removed
- Manual API token field in the options page.

## [v1.1.0] - 2026-06-25
### Added
- Scan chooser shows each image's resolutions as inline tokens.
### Changed
- A blocked image preview now shows a "preview blocked" note instead of a blank tile.

## [v1.0.1] - 2026-06-21
### Added
- Force re-download for skipped-archive jobs, which plain retry would re-skip.
### Changed
- Renamed the extension to monsender.
### Fixed
- Scans and right-click now send the largest available image, not the rendered thumbnail.
- Scan cards show each image's real loaded size.

## [v1.0.0] - 2026-06-19
### Added
- Initial release.
