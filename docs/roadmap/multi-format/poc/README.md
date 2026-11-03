# OFD Reader Isolated POC

This project is isolated from MdStudio's production reader and dependencies.

## Run in Tauri WebView

1. From this directory, run `npm ci`, then `npm run dev`.
2. In another terminal, run `../../../../node_modules/.bin/tauri dev`.
3. Load the MIT invoice fixture from the toolbar, or choose an OFD file.

The left panel mounts `@ofdrw/ofdrw-viewer-ui/react` with its built-in toolbar disabled and custom controls using the documented React ref. The right panel opens the same file with the engine and paints its current page to a host-owned Canvas. The sample selector switches among the local read-only OFDRW fixtures.

The “加载本机字体回退” control reads one user-selected TTF/OTF/TTC into memory (maximum 32 MiB) and passes it as an engine/UI supplementary font. It is optional and does not upload or persist the font. This tests whether missing glyphs can be filled without editing the OFD; it is a POC control, not a production font policy.

Run the offline fixture checks with `npm run test:samples`. On macOS, `npm run test:font-fallback` reproduces the original invoice's empty text layer and confirms the installed STHeiti fallback restores searchable text. Set `OFD_FONT_PATH` to another local TTF/OTF/TTC path when needed. License and sample distribution caveats are in `SAMPLES.md` and `UPSTREAM-SAMPLES-NOTICE.md`.

This harness must not be used as a production support claim. Avoid putting personal or confidential documents in it.
