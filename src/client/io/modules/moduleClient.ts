import { onServerEvent, sendServerEvent } from '../network/customEvents';

// Loads the module browser entries the server serves and runs them with an
// `engine` API. Like server scripts, this is the server owner's code, so it
// runs with no sandbox.

interface ClientModule {
  id: string;
  client: string;
}

function moduleContainer(id: string): HTMLElement {
  let host = document.getElementById('module-ui');
  if (!host) {
    host = document.createElement('div');
    host.id = 'module-ui';
    document.body.appendChild(host);
  }
  const elId = `module-ui-${id}`;
  let el = document.getElementById(elId);
  if (!el) {
    el = document.createElement('div');
    el.id = elId;
    host.appendChild(el);
  }
  return el;
}

function makeEngineApi(id: string) {
  return {
    onServerEvent,
    sendServerEvent,
    /** A DOM element this module owns; render UI into it. */
    mount: () => moduleContainer(id),
    log: (...args: unknown[]) => console.log(`[module:${id}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[module:${id}]`, ...args),
    error: (...args: unknown[]) => console.error(`[module:${id}]`, ...args),
  };
}

export async function loadClientModules(): Promise<void> {
  let modules: ClientModule[];
  try {
    modules = await (await fetch('/modules')).json();
  } catch (e) {
    console.error('[modules] failed to fetch module list', e);
    return;
  }

  for (const m of modules) {
    try {
      const code = await (await fetch(`/modules/${m.id}/client`)).text();
      // eslint-disable-next-line no-new-func
      new Function('engine', code)(makeEngineApi(m.id));
      console.log(`[modules] client loaded: ${m.id}`);
    } catch (e) {
      console.error(`[modules] client "${m.id}" failed to load`, e);
    }
  }
}
