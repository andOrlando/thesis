import type { TypeInfo } from "../typeinfo/types.ts"
import { Trace, TraceSet, compute_typeinfo, FunctionTI, ObjectTI, WRAP_PARAMID } from "../typeinfo/types.ts"
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


function wrap_function(f: Function, loc: string): Function {
    // if we've already wrapped/are profiling this function, ignore
    if (f.hasOwnProperty(WRAP_PARAMID)) return f

    // at this point we've created the typeinfo so we
    // should already be in the function_typeinfo_map
    const fti = FunctionTI.function_typeinfo_map.get(f)!
    const wrapped = function(...args: any[]) {
      const trace = new Trace(args, loc)
      fti.traces.add(trace)
      args = args.map((arg, i) => process_argument(arg, trace.args[i], loc))
      const res = f(...args)

      // if we're not a generator just profile the return
      // if (typeof res !== "object" || (res instanceof GeneratorFunction)) {
      if (!(f.constructor instanceof GeneratorFunction)) {
        trace.returns = compute_typeinfo(res, loc)
        return process_argument(res, trace.returns, loc)
      }

      // otherwise we have to wrap the generator in the same way
      const _next = res.next
      res.next = function(...b: any[]) {
        const next: { value: any, done?: boolean } = _next(...b)
        const ti = compute_typeinfo(next.value, loc)
        if (!next.done) trace.yields.push(ti)
        else trace.returns = ti
        next.value = process_argument(next.value, ti, loc)
        return next
      }
      return res
    }
    FunctionTI.function_typeinfo_map.set(wrapped, fti)
    wrapped[WRAP_PARAMID] = f
    return wrapped
}

function wrap_object(o: Object, oti: ObjectTI, loc: string): Object {
  const proxy = new Proxy(o, {
    get(t: Object, p: string|symbol, reciever: any) {
      if (p === WRAP_PARAMID) return o
      return Reflect.get(t, p, reciever)
    },
    set(t: Object, p: string|symbol, v: any, reciever: any) {
     
      const ti = compute_typeinfo(v, loc)
      // if we don't already have a typeinfo for this it didn't exist before, so and it with undefined
      const other = oti.params.has(p) ? oti.params.get(p)! : compute_typeinfo(undefined, loc)
      
      oti.params.set(p, combine_types([ti, other]))
      return Reflect.set(t, p, v, reciever)
    }
  })
  objref_objti_map.set(proxy, oti)
  return proxy
}

function process_argument(arg: any, typeinfo: TypeInfo, loc: string) {
    if (typeof arg === "function") return wrap_function(arg, loc)
    if (typeof arg === "object" && arg !== null) {
      // we wanna wrap objects whose constructor is ``object''
      // TODO: do something about classes
      if (Object.getPrototypeOf(arg).constructor === ObjectFunction && !arg[WRAP_PARAMID])
        return wrap_object(arg, typeinfo as ObjectTI, loc)
    }
    return arg
  
}

global.__logarg = function(loc: string, ...args: any[]): [string|undefined, ...any[]] {
  if (!shouldprofile(loc)) return [undefined, ...args]
  
  const callid = crypto.randomUUID()
  inflight[callid] = new Trace(args, loc)
  

  // wrap all of our arguments as needed
  args = args.map((arg, i) => process_argument(arg, inflight[callid].args[i], loc))
  return [callid, ...args]
}

global.__logret = function(callid: string|undefined, f: Function, val?: any): any|undefined {
  if (callid === undefined) return val

  // bank inflight[callid], cleanup
  let loc = inflight[callid].location
  inflight[callid].returns = compute_typeinfo(val, loc)

  val = process_argument(val, inflight[callid].returns, inflight[callid].location)
  
  // if we're in the rare case that we call a function whose reference we can't get
  // users should not be able to get it either, so we just don't set funcref_trace_map
  // since it can never be passed into anything
  if (f === undefined) {
    calls[loc] = new TraceSet()
  }

  // if we've seen it wrapped first
  else if (funcref_trace_map.has(f)) {
    calls[loc] = funcref_trace_map.get(f)!
  }
  // if we've seen it called before but it's not in funcref_trace_map
  // this shouldn't happen
  else if (calls.hasOwnProperty(loc)) {
    funcref_trace_map.set(f, calls[loc])
  }
  // if we've never seen it before
  else {
    const traceset = new TraceSet()
    calls[loc] = traceset
    funcref_trace_map.set(f, traceset)
  }

  // bank the parameters/returns
  calls[loc].add(inflight[callid])
  delete inflight[callid]

  return val
}

global.__logyield = function(callid: string|undefined, val: any): any {
  if (callid === undefined) return val
  
  const typeinfo = compute_typeinfo(val, inflight[callid].location)
  inflight[callid].yields.push(typeinfo)
  val = process_argument(val, typeinfo, inflight[callid].location)
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
      const trace = inflight[callid]
      const ti = compute_typeinfo(next.value, trace.location)
      
      if (!next.done) trace.yields.push(ti)
      else trace.returns = ti
      next.value = process_argument(next.value, ti, inflight[callid].location)
      return next
    }
    return iter
  }
  return val
}



