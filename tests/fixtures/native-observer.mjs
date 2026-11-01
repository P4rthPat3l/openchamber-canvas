import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export default {
  id: 'canvas-test-observer',
  async setup(ctx) {
    const tools = (await ctx.tool.list()).filter(tool => tool.id.startsWith('canvas_'));
    const { data: skills } = await ctx.skill.list();
    const skill = skills.find(skill => skill.id === 'canvas-authoring');
    const session = await ctx.session.create({ title: 'Native Canvas acceptance fixture', permissions: [{ action: 'skill', resource: 'canvas-authoring', effect: 'allow' }] });
    const loader = (await ctx.tool.list()).find(tool => tool.id === 'skill');
    const loadedSkill = await loader.execute({ id: 'canvas-authoring' }, { sessionID: session.id, agent: 'build', signal: new AbortController().signal });
    const published = await tools.find(tool => tool.id === 'canvas_publish').execute(
      { title: 'Actual OpenCode registration', html: '<h1>Native plugin</h1>' },
      { sessionID: session.id, signal: new AbortController().signal },
    );
    await writeFile(path.join(ctx.location.directory, 'native-result.json'), JSON.stringify({
      version: ctx.app.version,
      names: tools.map(tool => tool.id).sort(),
      result: JSON.parse(published.content),
      directory: session.location.directory,
      skill,
      loadedSkill: loadedSkill.content,
    }));
  },
};
