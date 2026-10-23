# Changelog

## [v1.4.3] - 2026-10-23
### Changed
- Colours follow monloader's new palette.
- The popup's pause control reads [pause] or [resume], as monloader's does.

### Fixed
- Enriched, replaced or matched jobs show that outcome in green, not "nothing to add".
- A collapsed series shows its worst window's status, and continue resumes the newest capped window.

## [v1.4.2] - 2026-10-16
### Fixed
- A file monbooru cannot take reads "monbooru does not take this file type", not an archive hit.
- A monloader still in first-run setup reads "setup not finished", not a failed send.
- A partial or interrupted send paints the badge amber, not the queued indigo.
- Images on a local file:// page send instead of failing with HTTP 400.
- An expired pairing request says to connect again at once instead of timing out.
- Changing the monloader address unpairs the old one, so the same instance pairs again.

## [v1.4.1] - 2026-10-01
### Changed
- The chooser offers AVIF and JPEG XL images.

### Fixed
- A refused send names the reason: monbooru link paused, monbooru not set up, or API off.
- With no token held, a monloader that needs one reads "not paired yet", not "token rejected".
- The side panel's connection dot follows pairing, URL changes and outages.
- A batch with failures shows its result line in the warning or error colour.
- Clear all removes every finished job, interrupted ones included, past the first page.
- A collapsed series in the popup sums every window, not only the newest eight.
- The only-this-image toast appears only for images monloader can fetch, and spares finished jobs.
- A <picture> shows as one card and sends its full-size source, not the small fallback.
- Scanning with no readable tab says so, instead of showing the previous page's scan.
- The options address hint shows port 8456, where monloader listens.

## [v1.4.0] - 2026-09-05
### Changed
- The extension no longer need host permission.

### Fixed
- A monloader with no token set reads as "not paired yet", not unreachable.
- Failed jobs name the reason instead of showing monloader's raw error code.
- Queue rows show counts for every outcome, including the jobs monbooru enqueues.
- Force download is offered only on jobs where it can fetch again.
- Scanning from the popup opens the side panel on Chrome, with no manual open.
- The side panel picks up settings saved after it was opened, without a reload.
- The chooser says when a page was too large to scan fully.
- Picking another resolution updates the size and type line when previews are off.
- Changing the monloader URL abandons a pairing waiting for approval.
- The pairing prompt points at monloader's settings -> pairing, where you approve it.

## [v1.3.1] - 2026-07-31
### Fixed
- Right-click sends the post, not the raw file, on a supported site alias set in monloader such as *.donmai.us. ([#3](https://github.com/monbooru/monsender/issues/3))

Thanks to @gary-host-laptop for the report (https://github.com/monbooru/monsender/issues/3).

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

Thanks to @gary-host-laptop for the suggestions (https://github.com/monbooru/monsender/issues/3).

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
