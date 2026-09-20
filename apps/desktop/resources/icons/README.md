# Geared Term icon set

The source artwork is `geared-term-master.png`, a transparent RGBA mark generated for the Geared
Term brand. Derived files are kept in this directory so packaging works without a build-time icon
conversion step:

- `geared-term.icns` is the macOS application icon.
- `geared-term.ico` contains the Windows launcher sizes.
- `linux/` contains the freedesktop launcher sizes from 16px through 1024px.
- `geared-term.png` is the 1024px runtime icon used by Linux and Windows Electron windows.

The renderer uses its own 256px copy under `src/renderer/src/assets/` for the title bar, while each
renderer HTML entry uses the matching public copy as its favicon.
