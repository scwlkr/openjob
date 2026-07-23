export type LocalDomainPurgeBoundary = () => Promise<void>;

const noDomainCacheYet: LocalDomainPurgeBoundary = async () => undefined;
let purgeBoundary = noDomainCacheYet;

// Issue #39 will register its SQLCipher database and device-only SecureStore
// key purge here. Until then, auth exits invoke the boundary without choosing
// a forbidden placeholder storage location.
export function registerLocalDomainPurgeBoundary(
  implementation: LocalDomainPurgeBoundary,
) {
  purgeBoundary = implementation;
  return () => {
    if (purgeBoundary === implementation) purgeBoundary = noDomainCacheYet;
  };
}

export function purgeLocalDomainCache() {
  return purgeBoundary();
}
