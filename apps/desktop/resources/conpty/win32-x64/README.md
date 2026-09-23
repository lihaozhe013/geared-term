# Microsoft ConPTY runtime for Windows x64

These files are copied from Microsoft's official `Microsoft.Windows.Console.ConPTY`
NuGet package, version `1.24.260402001`, published with Windows Terminal release
[`v1.24.10921.0`](https://github.com/microsoft/terminal/releases/tag/v1.24.10921.0).
The package is available at
[`Microsoft.Windows.Console.ConPTY.1.24.260402001.nupkg`](https://github.com/microsoft/terminal/releases/download/v1.24.10921.0/Microsoft.Windows.Console.ConPTY.1.24.260402001.nupkg).
The package declares the MIT license. Microsoft Terminal's license is available at
https://github.com/microsoft/terminal/blob/v1.24.10921.0/LICENSE.

| File | NuGet package path | SHA-256 |
| --- | --- | --- |
| `conpty.dll` | `runtimes/win-x64/native/conpty.dll` | `AEEE2BE15A78A0E8244496E8563E473F626D754297093D3B94934A1DB4FB26FA` |
| `OpenConsole.exe` | `build/native/runtimes/x64/OpenConsole.exe` | `CC557520C04A2BBDA4909292E5E8929C7DB38CA195DE60E2548DEE78E07D84BD` |

The NuGet package SHA-256 is
`55D0962A91E0035BE5696BC9E416F0A38EF9ACC6110E3351D1CFAD44680B9AF0`.
On 2026-09-23, Windows Authenticode verification reported `Valid` for both files
with signer `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond,
S=Washington, C=US`. The `OpenConsole.exe` signer certificate thumbprint was
`3F56A45111684D454E231CFDC4DA5C8D370F9816`; the `conpty.dll` thumbprint was
`F5877012FBD62FABCBDC8D8CEE9C9585BA30DF79`.

`manifest.json` pins the binary digests. The staging and packaging hooks verify
those digests and stop Windows x64 development startup or packaging if either
file is missing or has changed.
