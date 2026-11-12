# monsender

A Firefox and Chrome extension for [monloader](https://github.com/monbooru/monloader). It sends the page you're on, a right-clicked image or video, or images you pick from the page to monloader's download queue, which pushes them into [monbooru](https://github.com/monbooru/monbooru).

[![Download for Firefox](https://img.shields.io/badge/download%20for-Firefox-5c6bc0?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/monsender/)
[![Download for Chrome](https://img.shields.io/badge/download%20for-Chrome-5c6bc0?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/monsender/jhiaelblkhpfbmaijnlbmhpcjhghnack)

## Features

- Send the current page from the toolbar button or with Ctrl+Shift+L
- Right-click an image or video and choose **Send to monloader**
- Scan a page for images and pick which to send from a side panel
- Watch and manage the monloader queue

## Related applications

monsender is a companion browser extension for monloader. It hands the page you're viewing to monloader's download queue:

```mermaid
---
config:
  layout: dagre
  flowchart:
    wrappingWidth: 200
---
flowchart LR
    web["`- Any booru or gallery supported by gallery-dl
- Direct image URL`"]
    ptr["`Hydrus
Public Tag Repository`"]
    sender(["`**monsender**
browser extension`"])
    loader["`**monloader**
downloader`"]
    booru["`**monbooru**
Your self-hosted booru`"]

    web -->|browse| sender
    sender -->|send URL| loader
    web -->|paste URL| loader
    loader -->|push images, tags, source| booru

    booru -.->|lookup by hash| loader
    loader -.->|reverse lookup: md5 + similarity| web
    ptr <-.->|"`sync: sha256 tags + aliases + implications
contribute back`"| loader

    classDef hub  fill:#5c6bc0,stroke:#9fa8da,stroke-width:3px,color:#ffffff;
    classDef tool fill:#16161c,stroke:#5c6bc0,stroke-width:1.5px,color:#c8c8c8;
    classDef src  fill:#16161c,stroke:#8888a0,stroke-width:1px,color:#8888a0;

    class sender hub;
    class loader,booru tool;
    class web,ptr src;
```

- **monsender**: this application; sends the URL of the page you're browsing to monloader.
- **[monloader](https://github.com/monbooru/monloader)**: downloader; fetches files and per-post metadata (via gallery-dl) and pushes them into a monbooru gallery over the REST API; also answers monbooru's reverse lookups (boorus, IQDB/SauceNAO, Hydrus PTR) and source refetches.
- **[monbooru](https://github.com/monbooru/monbooru)**: self-hosted booru; organizes, tags, and serves your collection.

## Install

Install it from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/monsender/) or the [Chrome Web Store](https://chromewebstore.google.com/detail/monsender/jhiaelblkhpfbmaijnlbmhpcjhghnack).

Then open the extension's options, set your monloader URL, and click **connect to monloader**. Approve the request in monloader under **Settings → Pairing**, in the **monsender extension** block.

See the [monsender documentation](https://monbooru.github.io/mondocs/addons/monsender/index.html) for help.

## Permissions

`activeTab`, `scripting`, `storage` and `contextMenus` (plus `sidePanel` on Chrome). It reads a page only when you click, and sends only to the monloader URL you set. With previews on, the scan's thumbnails load from the sites hosting the images. See [PRIVACY.md](PRIVACY.md).

## Build

```
node build.js        # writes dist/chrome and dist/firefox
```

## License

[AGPL-3.0](LICENSE), with portions derived from MPL-2.0 code; see the license file.

## Acknowledgements

See [monbooru's acknowledgements](https://github.com/monbooru/monbooru#acknowledgements).
