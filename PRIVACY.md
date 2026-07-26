# Privacy policy

monsender collects nothing and sends nothing to anyone except the
monloader server you configure.

- No analytics, no telemetry, no remote code. All code ships in the extension
  package.
- The only network requests the extension makes are to the monloader URL you
  set in its options. It never contacts monbooru directly, and never any
  third-party server.
- What is sent to your monloader: the URL you choose to send (the page, a
  right-clicked target, or images you pick from a page scan) and, if you have
  paired, your monloader API token as a bearer header.
- The token is issued by your monloader, not set by you: "connect to
  monloader" asks it for a pairing, you approve that request in monloader,
  and it hands back a token the extension stores. Changing the monloader URL
  discards it, so a token issued by one instance is never sent to another.
- The page URL and the page DOM are read only when you act (click the toolbar
  button, use the keyboard shortcut, pick a context-menu item, or run a scan),
  under the `activeTab` permission. Nothing is read in the background.
- Your settings (monloader URL, token, preferences) are stored locally in the
  browser (`storage.local`). 
