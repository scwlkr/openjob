# Encrypt native credentials and cache at rest

The native app stores session credentials only through iOS Keychain and Android Keystore via Expo SecureStore. Its read-only Group and Task cache uses SQLCipher-backed SQLite with a random per-installation database key held device-only in SecureStore; neither cache nor key participates in cloud backup. When App Lock is enabled, system authentication releases the database key into memory only until the lock timeout. Sign-out or a change of User destroys the key and cached domain data. Credentials and domain data never use AsyncStorage.
