// paired down version of https://github.com/midrissi/func-loc/blob/master/src/session-manager.class.ts
import { Session } from "inspector/promises"

const s = new Session();
const PREFIX = crypto.randomUUID()
global[PREFIX] = {}

export type Location = {
  column: number
  line: number
  location: string
}

export async function locate(f: Function): Promise<Location|undefined> {
  let fid = crypto.randomUUID()
  
  global[PREFIX][fid] = f

  const evaled = await s.post("Runtime.evaluate", { expression: `global["${PREFIX}"]["${fid}"]`, objectGroup: PREFIX })
  if (evaled.result.objectId === undefined) return

  const props = await s.post("Runtime.getProperties", { objectId: evaled.result.objectId })
  if (props.internalProperties === undefined) return

  const location = props.internalProperties.find((prop) => prop.name === '[[FunctionLocation]]');
  if (location?.value === undefined) return
  const source = this.scripts[location.value.value.scriptId].url;

  return {
    column: location.value.value.columnNumber,
    line: location.value.value.lineNumber,
    location: source.substr(7)
  }
}

export async function connect_inspector() {
  s.connect();
  s.on('Debugger.scriptParsed', (res) => {
    this.scripts[res.params.scriptId] = res.params;
  });
  await s.post("Debugger.enable")
}

export async function disconnect_inspector() {
  await s.post('Runtime.releaseObjectGroup', {
    objectGroup: PREFIX,
  });
  s.disconnect()
}

