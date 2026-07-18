# OpenJob CLI

Requires macOS and Node.js 22.13 or newer. Install OpenJob v0.3.1 from GitHub:

```bash
npm install --global https://github.com/scwlkr/openjob/releases/download/v0.3.1/openjob-0.3.1.tgz
```

Then run `openjob auth login` and `openjob --help`. OpenJob stores the Firebase
refresh credential in the macOS credential store and keeps only the current
Group ID in local config. It has no local Task database or offline mode.
