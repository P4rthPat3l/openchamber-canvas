import { pathToFileURL } from 'node:url';

// Exercise the shipped JavaScript at its host boundary, without casting SDK types.
const { default: plugin } = await import(pathToFileURL(process.argv[2]).href);
const input = JSON.parse(await new Response(process.stdin).text());
const registrations = new Set();
const skillRegistrations = new Set();
let directory = input.directory;
let failSession = false;
const ctx = {
  session: {
    async get({ sessionID }, { signal }) {
      signal.throwIfAborted();
      if (failSession) throw new Error('Session unavailable');
      return { id: sessionID, location: { directory }, subpath: 'nested/project' };
    },
  },
  tool: {
    async transform(transform) {
      const entries = [];
      const namespaces = [];
      transform({
        namespace(value) { namespaces.push(value); },
        add(value) { entries.push(value); },
      });
      const registration = { entries, namespaces, async dispose() { registrations.delete(registration); } };
      registrations.add(registration);
      return registration;
    },
  },
  skill: {
    async transform(transform) {
      const entries = [];
      transform({ add(value) { entries.push(value); } });
      const registration = { entries, async dispose() { skillRegistrations.delete(registration); } };
      skillRegistrations.add(registration);
      return registration;
    },
  },
};
const tools = () => [...registrations].flatMap(registration => registration.entries);
const skills = () => [...skillRegistrations].flatMap(registration => registration.entries);
let cleanup;
try {
  cleanup = await plugin.setup(ctx);
} catch (error) {
  if (input.scenario !== 'setup') throw error;
  console.log(JSON.stringify({ error: error.message, tools: tools().length, skills: skills().length }));
  process.exit(0);
}
async function call(name, args, signal = new AbortController().signal) {
  const tool = tools().find(tool => tool.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  const result = await tool.execute(args, { sessionID: 'ses_canvas_native_test', signal });
  return JSON.parse(result.content);
}
try {
  let result;
  if (input.scenario === 'call') {
    result = await call(input.name, input.args);
  } else if (input.scenario === 'setup') {
    result = { tools: tools().length, skills: skills().length };
  } else {
    const catalog = tools().map(tool => ({ name: tool.name, description: tool.description, input: tool.input, options: tool.options }));
    const skillCatalog = skills();
    const namespaces = [...registrations].flatMap(registration => registration.namespaces);
    const first = await call('publish', { title: 'Native first', html: '<h1>First</h1>', sessionId: 'spoofed' });
    directory = input.movedDirectory;
    const second = await call('publish', { title: 'Native moved', html: '<h1>Moved</h1>' });
    const local = await call('list', {});
    const aborted = new AbortController();
    aborted.abort(new Error('Cancelled before write'));
    let cancellation;
    try { await call('publish', { title: 'Cancelled', html: '<h1>Cancelled</h1>' }, aborted.signal); }
    catch (error) { cancellation = error.message; }
    failSession = true;
    let sessionError;
    try { await call('publish', { title: 'Wrong project', html: '<h1>Wrong</h1>' }); }
    catch (error) { sessionError = error.message; }
    failSession = false;
    let invalid;
    try { await call('update', { id: first.id, html: '<h1>No base</h1>' }); }
    catch (error) { invalid = JSON.parse(error.message); }
    const retainedTool = tools().find(tool => tool.name === 'publish');
    await cleanup();
    const unloaded = tools().length;
    const unloadedSkills = skills().length;
    let unloadedError;
    try { await retainedTool.execute({ title: 'After unload', html: '<h1>No</h1>' }, { sessionID: 'ses_canvas_native_test', signal: new AbortController().signal }); }
    catch (error) { unloadedError = error.name; }
    cleanup = await plugin.setup(ctx);
    result = { catalog, skillCatalog, namespaces, first, second, local, cancellation, sessionError, invalid, unloaded, unloadedSkills, unloadedError, reloaded: tools().length, reloadedSkills: skills().length, registrations: registrations.size, skillRegistrations: skillRegistrations.size };
  }
  console.log(JSON.stringify(result));
} finally {
  await cleanup();
}
