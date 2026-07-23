# Require cross-platform native release evidence

A native slice may merge after its automated suite and focused iOS Simulator and Android Emulator checks pass, but it is not complete until `@qa-one` and `@qa-two` pass the written real-world journey through TestFlight and Play Internal Testing on physical iPhone and Android devices. A failure on either coequal platform blocks promotion on both. Each candidate records concise evidence rather than relying on remembered manual testing.

Public release candidates additionally verify clean installation and upgrade, poor-network and offline recovery, background and foreground transitions, Push Notification routing, VoiceOver and TalkBack, system text scaling, light and dark appearances, and adaptive phone, tablet, and foldable layouts. The matrix uses emulators or managed device testing where necessary, but always retains the physical iPhone and Android gate.
