# Real-GPU testing on the Windows PC (GTX 1650)

The Linux box has no GPU (software rendering, ~0 fps). The Windows PC does, but only inside the **logged-in desktop session**:
over SSH / a service the session has no GPU and Chrome falls back to "Microsoft Basic Render Driver". So scenarios run through a one-shot
scheduled task with `/IT` (interactive) and Chrome is forced onto the NVIDIA card via a per-app GPU preference (registry, set once).

## One-time setup (already done on this PC)
- `C:\Users\ifix4\rp\` holds `www/` (built game), `gpu.mjs`, `run.ps1`, `node_modules/puppeteer-core`.
- `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` : `C:\Program Files\Google\Chrome\Application\chrome.exe = GpuPreference=2;` (High performance GPU).

## Run
From the Linux repo:  `node tools/gpu/remote.mjs <scenario>`   (scenarios: menu | fps | ground | city)
It builds nothing: run `node build.mjs` first. It uploads game.js/index.html + harness, runs the scenario on the GPU, and downloads shots to `shots/gpu/`.
