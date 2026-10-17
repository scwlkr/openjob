import { simulatorFixtureAllowed } from '../simulator-smoke';
jest.mock('expo', () => ({ ...jest.requireActual('expo'), registerRootComponent: jest.fn() }));

it('allows the fixture only for the development simulator identity', () => {
  expect(simulatorFixtureAllowed(false, 'dev.openjob.app.dev')).toBe(true);
  expect(simulatorFixtureAllowed(true, 'dev.openjob.app.dev')).toBe(false);
  expect(simulatorFixtureAllowed(false, 'dev.openjob.app')).toBe(false);
  expect(simulatorFixtureAllowed(false, 'dev.openjob.app.preview')).toBe(false);
  expect(simulatorFixtureAllowed(false, undefined)).toBe(false);
});
