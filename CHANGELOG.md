# Changelog

## [v1.3.1] - 2026-07-31
### Fixed
- Right-click sends the post, not the raw file, on a supported site alias set in monloader such as *.donmai.us. ([#3](https://github.com/monbooru/monsender/issues/3))

Thanks to @gary-host-laptop for the report (https://github.com/monbooru/monsender/issues/3)

## [v1.3.0] - 2026-07-26
### Added
- Right-click send now offers a toast to narrow the send to the pointed image. ([#3](https://github.com/monbooru/monsender/issues/3))
### Changed
- Direct file sends carry the page URL, recorded as the item's source. ([#3](https://github.com/monbooru/monsender/issues/3))
- Chooser thumbnails load the smallest advertised variant; videos load only once visible.
- The supported site list is cached, so the first send after idle no longer waits on it.
### Fixed
- Batch sends from the chooser now say why they failed, not just a count.
- A revoked host permission is reported as such, not as a connection failure.
- Test connection pairs the token only with the saved origin and refuses malformed URLs.
- The chooser says when a page could not be scanned instead of "no images found".
- Scans keep lazy-loaded images whose real size is only advertised in srcset.
- The chooser and popup no longer offer file types monloader declines.
- Picking another resolution after a blocked preview restores the preview.

Thanks to @gary-host-laptop for the suggestions (https://github.com/monbooru/monsender/issues/3)

## [v1.2.2] - 2026-07-21
### Added
- Help link in the options page, pointing at the monsender documentation.
### Fixed
- Right-click sends the post, not the raw image file, when monloader's site list is unreachable.
- Pairing prompt now points at monloader's monsender settings, where you approve the request.

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
