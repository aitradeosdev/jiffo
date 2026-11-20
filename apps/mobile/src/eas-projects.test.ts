import { describe, expect, it } from 'vitest';
import { easProject } from '../app.config';

/**
 * Each store app is its own Expo project, named in eas-projects.json once `eas init` has made it (see
 * docs/mobile-builds.md). The build reads the id for the app it builds.
 */
describe('Expo project ids', () => {
  const projects = { customer: 'customer-project', agent: 'agent-project' };

  it('names the project of the app being built', () => {
    expect(easProject(projects, 'customer')).toEqual({ eas: { projectId: 'customer-project' } });
    expect(easProject(projects, 'agent')).toEqual({ eas: { projectId: 'agent-project' } });
  });

  it("names none while the app's project isn't made yet, so the config still reads", () => {
    expect(easProject({ ...projects, agent: '' }, 'agent')).toEqual({});
  });
});
