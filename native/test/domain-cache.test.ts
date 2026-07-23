import {
  purgeLocalDomainCache,
  registerLocalDomainPurgeBoundary,
} from "../src/domain-cache";

test("invokes the replaceable #39 purge boundary without choosing cache storage", async () => {
  const purge = jest.fn(async () => undefined);
  const unregister = registerLocalDomainPurgeBoundary(purge);

  await purgeLocalDomainCache();
  expect(purge).toHaveBeenCalledTimes(1);

  unregister();
  await expect(purgeLocalDomainCache()).resolves.toBeUndefined();
  expect(purge).toHaveBeenCalledTimes(1);
});
