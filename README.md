# monsender

A small firefox or chrome extension for [monloader](https://github.com/monbooru/monloader). 
It sends the page you are looking at, a right-clicked image or video, or images you pick from a page scan to your monloader download queue, which pushes them into monbooru.

## Features

- Send the current page to monloader (via toolbar or via Ctrl+Shift+L shortcut). 
- Right-click an image or video and "Send to monloader".
- Scan a page for images and pick which to send from a docked side panel.
- Watch and manage the monloader queue

## Related applications

monsender is a companion browser extension for monloader. It hands the page you're viewing to monloader's download queue :

```mermaid
flowchart LR
    web["- Any booru or gallery supported by gallery-dl<br/>- Direct image URL"]
    ptr["Hydrus<br/>Public Tag Repository"]
    sender(["<b>monsender</b><br/>browser extension"])
    loader["<b>monloader</b><br/>downloader"]
    booru["<b>monbooru</b><br/>Your self-hosted booru"]

    web -->|browse| sender
    sender -->|send URL| loader
    web -->|paste URL| loader
    loader -->|push images, tags, source| booru

    booru -.->|lookup by hash| loader
    loader -.->|reverse lookup: md5 + similarity| web
    ptr <-.->|"sync: sha256 tags + aliases + implications<br/>contribute back (planned)"| loader

    classDef hub  fill:#5c6bc0,stroke:#9fa8da,stroke-width:3px,color:#ffffff;
    classDef tool fill:#16161c,stroke:#5c6bc0,stroke-width:1.5px,color:#c8c8c8;
    classDef src  fill:#16161c,stroke:#8888a0,stroke-width:1px,color:#8888a0;

    class sender hub;
    class loader,booru tool;
    class web,ptr src;
```

- **monsender** : this application; sends the URL of the page you're currently browsing to monloader.
- **[monloader](https://github.com/monbooru/monloader)** : downloader; fetches files and per-post metadata (via gallery-dl) and pushes them into a monbooru gallery over the REST API; also answers monbooru's reverse lookups (boorus, IQDB/SauceNAO, Hydrus PTR) and source refetches.
- **[monbooru](https://github.com/monbooru/monbooru)** : self-hosted booru; organizes, tags, and serves your collection.

## Permissions

Required permissions are minimal : `activeTab`, `scripting`, `storage`, `contextMenus`
(and `sidePanel` on Chrome). It reads a page only on an explicit click. The
single host it ever contacts is the monloader URL you configure, granted at
runtime when you save settings.

## Install

<a href="https://addons.mozilla.org/en-US/firefox/addon/monsender/"><img alt="Get the Add-on" height="48" src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg"></a>

Open the extension's options, set your monloader URL, and click **connect to monloader**; approve the pairing request in monloader under **Settings -> monsender** (needs monloader v1.2.0 or newer).

See the [monsender documentation](https://monbooru.github.io/mondocs/addons/monsender/index.html) for help.

## Build

Build the per-browser bundles:

```
node build.js        # writes dist/chrome and dist/firefox
```

## Attribution and license

monsender is licensed under **AGPL-3.0-or-later** (see `LICENSE`).

The in-page image detection uses code from [ushiro](https://github.com/gary-host-laptop/ushiro) by
**gary-host-laptop**, and [behind!](https://github.com/kubuzetto/behind) by **kubuzetto**, originally
under MPL-2.0. The MPL-2.0 notice is preserved in `LICENSE`.
