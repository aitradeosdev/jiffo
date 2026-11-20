import { describe, expect, it } from 'vitest';
import appConfig, { easProject } from '../app.config';
import projects from '../eas-projects.json';

/**
 * Each store app is its own Expo project, named in eas-projects.json once `eas init` has made it (see
 * docs/mobile-builds.md). The build reads the id for the app it builds.
 */
describe('Expo project ids', () => {
  const sample = { customer: 'customer-project', agent: 'agent-project' };

  it('names the project of the app being built', () => {
    expect(easProject(sample, 'customer')).toEqual({ eas: { projectId: 'customer-project' } });
    expect(easProject(sample, 'agent')).toEqual({ eas: { projectId: 'agent-project' } });
  });

  it("names none while the app's project isn't made yet, so the config still reads", () => {
    expect(easProject({ ...sample, agent: '' }, 'agent')).toEqual({});
  });

  it('builds under the Expo account the projects belong to, named in the same file', () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    expect(config.owner).toBe(projects.owner);
    expect(config.extra?.eas).toEqual({ projectId: projects.customer });
  });
});
