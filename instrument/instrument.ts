import hash from "object-hash"
import locate from "../utils/function_location.ts"
import type { Location } from "../utils/function_location.ts"

// we will pass around reference typeinfos rather than the full information for two reasons:
// 1. anything we see later with the same ref we want to update the types of everything else with that ref
// 2. for cyclic objects it's easier to work with refs initially rather than try to unroll
const function_typeinfo_map: WeakMap<Function, FunctionTI> = new WeakMap()
const object_typeinfo_map: WeakMap<Object, ObjectTI> = new WeakMap()

function compute_typeinfo(t: any, refs?: WeakMap<any, TypeInfo>) {
  if (refs === undefined) refs = new WeakMap()
  switch (typeof t) {
    case "object":
      // null is a primitive even though it's an object
      if (t === null) return new PrimitiveTI(null)
      // if we've seen this reference before, make it circular
      if (refs.has(t)) return refs.get(t)!
      
      // TODO: add cases for array, class, object without class, primitive classes vs. imported, etc 
      return new ObjectTI(t, refs)
    case "function":
      return new FunctionRefTI(t)
    default:
      return new PrimitiveTI(t)
  }
}
class TypeInfo {
  type: "string"|"number"|"bigint"|"boolean"|"undefined"|"symbol"|"null"|"object"|"function"
  constructor(t: any) {
    this.type = typeof t
  }
  // toString is expected to work as a hash (and will be used in TraceSet)
  // such that two identical TypeInfos produce the same value and two different
  // ones produce a different value
  toString(): string {
    return this.type
  }
}
class PrimitiveTI extends TypeInfo {
  constructor(t: string|number|bigint|boolean|undefined|symbol|null) {
    super(t)
    // typeof null === "object" so we need to have this case
    if (t === null) this.type = "null"
  }
}
class FunctionRefTI extends TypeInfo {
  ref: Function
  constructor(t: Function) {
    super(t)
    this.ref = t
    if (!function_typeinfo_map.has(t)) {
      function_typeinfo_map.set(t, new FunctionTI(t))
    }
  }
  get location() {
    return function_typeinfo_map.get(this.ref)!.location
  }
  get params() {
    return function_typeinfo_map.get(this.ref)!.params
  }
  get returns() {
    return function_typeinfo_map.get(this.ref)!.returns
  }
  get uuid() {
    return function_typeinfo_map.get(this.ref)!.uuid
  }
  toString() {
    return this.uuid
  }
}
class FunctionTI extends TypeInfo {
  // TODO: it's probably bad to have this as a promise
  // not sure yet how to resolve the async
  location: Promise<Location|undefined>
  params: TypeInfo[]
  returns: TypeInfo[]
  uuid: string
  constructor(t: Function) {
    super(t)
    this.uuid = crypto.randomUUID()
    this.location = locate(t)
  }
}
class ObjectTI extends TypeInfo {
  params: Map<string, TypeInfo>
  constructor(t: Object, refs: WeakMap<any, TypeInfo>) {
    super(t)
    this.params = new Map()

    refs.set(t, this)
    for (const key in Object.keys(t)) {
      this.params.set(key, compute_typeinfo(t[key], refs))
    }
  }
  
  // we can cache tostring because these are effectively frozen
  #string_cached?: string
  toString() {
    if (this.#string_cached !== undefined) return this.#string_cached
    
    // first DFS through child objects to determine if ciruclar
    // then compute string iwth <ref> and [Circular] like how console.log does it

    const seen = new WeakSet()
    const repeated: ObjectTI[] = []
    function visit(obj: ObjectTI) {
      if (seen.has(obj) && !repeated.includes(obj)) repeated.push(obj)
      seen.add(obj)
      for (const child of obj.params.values()) {
        if (!(child instanceof ObjectTI)) continue
        visit(child)
      }
    }
    visit(this)
    
    // construct the string, knowing the reference indices from `repeated`
    // Since we're DFSing the first time we see a ref it should be the <ref *i>
    // and all future times should be children annotated with [Circular *i]
    const seen2 = new WeakSet()
    function _toString(obj: ObjectTI) {
      const params: string[] = []
      for (const key of obj.params.keys()) {
        const value = obj.params.get(key)!
        if (!(value instanceof ObjectTI)) {
          params.push(`${key}:${value}`)
          continue
        }

        // if this isn't circular we're good
        let idx = repeated.indexOf(value)
        if (idx === -1) {
          params.push(`${key}:${_toString(value)}`)
        }
        
        // if it is circular and it's the first time we're seeing this, <ref *i>
        else if (!seen2.has(value)) {
          seen2.add(value)
          params.push(`${key}:<ref *${idx}>${_toString(value)}`)
        }

        // otherwise we're circular
        else {
          params.push(`${key}:<Circular *${idx}>`)
        }
      }
      return `{${params.join(",")}}`
    }
    
    this.#string_cached = _toString(this)
    return this.#string_cached
  }
  
}

class Trace {
  args: TypeInfo[]
  yields: TypeInfo[]
  returns: TypeInfo
  constructor(args: any[]) {
    // TODO: can we do this computation in a worker thread so collecting traces isn't blocking
    this.args = args.map(a => compute_typeinfo(a))
    this.yields = []
    this.returns = new PrimitiveTI(undefined)
  }
  toString() {
    return `[${this.args.join(",")}],[${this.yields.join(",")}],${this.returns}`
  }
}

class TraceSet {
  traces: Trace[]
  traceset: Set<string>

  constructor() {
    this.traces = []
    this.traceset = new Set()
  }

  add(trace: Trace) {
    const trace_s = trace.toString()
    if (this.traceset.has(trace_s)) return
    this.traceset.add(trace_s)
    this.traces.push(trace)
  }

  has(trace: Trace) {
    return this.traceset.has(trace.toString())
  }
}


const inflight: Record<string, Trace> = {}
const calls: Record<string, TraceSet> = {}

// TODO: actually implement
function shouldprofile(_loc: string): boolean {
  return true
}

global.__logarg = function(loc: string, ...args: any[]): [string|undefined, ...any[]] {
  if (!shouldprofile(loc)) return [undefined, ...args]
  
  const callid = crypto.randomUUID()
  inflight[callid] = new Trace(args)
  // TODO: wrap all functions before returning
  return [callid, ...args]
}

global.__logret = function(loc: string, callid: string|undefined, val?: any): any|undefined {
  if (callid === undefined) return val
  
  // bank inflight[callid], cleanup
  inflight[callid].returns = compute_typeinfo(val)
  if (calls[loc] === undefined) calls[loc] = new TraceSet()
  calls[loc].add(inflight[callid])
  delete inflight[callid]

  return val
}

global.__logyield = function(callid: string|undefined, val: any): any {
  if (callid === undefined) return val
  
  inflight[callid].yields.push(compute_typeinfo(val))
  return val
}

// delegated yield, wrap the iterator
global.__logdelyield = function<T>(callid: string|undefined, val: Iterator<T>): Iterator<T> {
  if (callid === undefined) return val
  const oldnext = val.next
  val.next = () => {
    const res = oldnext()
    inflight[callid].yields.push(compute_typeinfo(res))
    return res
  }
  return val
}

process.on("beforeExit", () => {
  // can schedule async tasks if I feel like it
  console.log(calls)
})
