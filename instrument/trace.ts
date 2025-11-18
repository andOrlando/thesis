import { Trace, TraceSet, compute_typeinfo, function_typeinfo_map, ObjectTI, WRAP_PARAMID } from "../typeinfo/types.ts"
import { combine_types } from "../typeinfo/combine.ts"
import { ObjectFunction, GeneratorFunction } from "../typeinfo/constructor_library.ts"

const inflight: Record<string, Trace> = {}
export const calls: Record<string, TraceSet> = {}

// map from an unwrapped function to its traces
export const funcref_trace_map: WeakMap<Function, TraceSet> = new WeakMap()
// map from object reference to object TypeInfo
export const objref_objti_map: WeakMap<Object, ObjectTI> = new WeakMap()

// TODO: actually implement
function shouldprofile(_loc: string): boolean {
  return true
}


function wrap_function(f: Function): Function {
    // if we've already wrapped/are profiling this function, ignore
    if (f.hasOwnProperty(WRAP_PARAMID)) return f

    // at this point we've created the typeinfo so we
    // should already be in the function_typeinfo_map
    const fti = function_typeinfo_map.get(f)!
    const wrapped = function(...args: any[]) {
      const trace = new Trace(args)
      fti.traces.add(trace)
      const res = f(...args)

      // if we're not a generator just profile the return
      if (typeof res !== "object" || res instanceof GeneratorFunction) {
        trace.returns = compute_typeinfo(res)
        return res
      }

      // otherwise we have to wrap the generator in the same way
      const _next = res.next
      res.next = function(...b: any[]) {
        const next: { value: any, done?: boolean } = _next(...b)
        if (!next.done) trace.yields.push(compute_typeinfo(next.value))
        else trace.returns = compute_typeinfo(next.value)
        return next
      }
      return res
    }
    function_typeinfo_map.set(wrapped, fti)
    wrapped[WRAP_PARAMID] = f
    return wrapped
}

function wrap_object(o: Object, oti: ObjectTI): Object {
  const proxy = new Proxy(o, {
    get(t: Object, p: string|symbol, reciever: any) {
      if (p === WRAP_PARAMID) return o
      return Reflect.get(t, p, reciever)
    },
    set(t: Object, p: string|symbol, v: any, reciever: any) {
     
      const ti = compute_typeinfo(v)
      // if we don't already have a typeinfo for this it didn't exist before, so and it with undefined
      const other = oti.params.has(p) ? oti.params.get(p)! : compute_typeinfo(undefined)
      
      oti.params.set(p, combine_types([ti, other]))
      return Reflect.set(t, p, v, reciever)
    }
  })
  objref_objti_map.set(proxy, oti)
  return proxy
}


global.__logarg = function(loc: string, ...args: any[]): [string|undefined, ...any[]] {
  if (!shouldprofile(loc)) return [undefined, ...args]
  
  const callid = crypto.randomUUID()
  inflight[callid] = new Trace(args)
  

  // wrap all of our arguments as needed
  args = args.map((arg, i) => {
    if (typeof arg === "function") return wrap_function(arg)
    if (typeof arg === "object" && arg !== null) {
      // we wanna wrap objects whose constructor is ``object''
      // TODO: do something about classes
      if (Object.getPrototypeOf(arg).constructor === ObjectFunction && !arg[WRAP_PARAMID])
        return wrap_object(arg, inflight[callid].args[i] as ObjectTI)
    }
    return arg
  })
  
  return [callid, ...args]
}

global.__logret = function(loc: string, callid: string|undefined, f: Function, val?: any): any|undefined {
  if (callid === undefined) return val

  // bank inflight[callid], cleanup
  inflight[callid].returns = compute_typeinfo(val)
  
  // if we've seen it wrapped first
  if (funcref_trace_map.has(f)) {
    calls[loc] = funcref_trace_map.get(f)!
  }
  else if (calls.hasOwnProperty(loc)) {
    funcref_trace_map.set(f, calls[loc])
  }
  else {
    const traceset = new TraceSet()
    calls[loc] = traceset
    funcref_trace_map.set(f, traceset)
  }
  // if we've seen it normally first
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
global.__logdelyield = function<T>(callid: string|undefined, val: Generator<T>): Generator<T> {
  if (callid === undefined) return val

  const _iter = val[Symbol.iterator]
  val[Symbol.iterator] = function() {
    let iter = _iter.call(val)
    let _next = iter.next
    iter.next = function(...a: any[]) {
      const next: { value: T, done?: boolean } = _next.call(iter, ...a)
      if (!next.done) inflight[callid].yields.push(compute_typeinfo(next.value))
      else inflight[callid].returns = compute_typeinfo(next.value)
      return next
    }
    return iter
  }
  return val
}



