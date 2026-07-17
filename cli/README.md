# OpenJob CLI

Requires macOS and Node.js 22.13 or newer. Install the current v0.1.0 release
candidate from GitHub:

```bash
npm install --global https://github.com/scwlkr/openjob/releases/download/cli-v0.1.0-rc.2/openjob-0.1.0-rc.2.tgz
```

Then run `openjob auth login` and `openjob --help`. OpenJob stores the Firebase
refresh credential in the macOS credential store and keeps only the current
Group ID in local config. It has no local Task database or offline mode.
