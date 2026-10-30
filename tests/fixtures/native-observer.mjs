import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export default {
  id: 'canvas-test-observer',
  async setup(ctx) {
    const tools = (await ctx.tool.list()).filter(tool => tool.id.startsWith('canvas_'));
    const session = await ctx.session.create({ title: 'Native Canvas acceptance fixture' });
    const published = await tools.find(tool => tool.id === 'canvas_publish').execute(
      { title: 'Actual OpenCode registration', html: '<h1>Native plugin</h1>' },
      { sessionID: session.id, signal: new AbortController().signal },
    );
    await writeFile(path.join(ctx.location.directory, 'native-result.json'), JSON.stringify({
      version: ctx.app.version,
      names: tools.map(tool => tool.id).sort(),
      result: JSON.parse(published.content),
      directory: session.location.directory,
    }));
  },
};
