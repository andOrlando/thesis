import { describe, it } from "node:test"
import assert from "node:assert"

import { compute_typeinfo, Trace } from "../typeinfo/types.ts"
import { combine_traces, combine_types } from "../typeinfo/combine.ts"

function make_traces(...traces) {
  let res = []
  traces.forEach((trace, i) => {
    res.push(new Trace(trace.slice(0, -2), ""))
    res[i].yields = trace[trace.length-2].map(compute_typeinfo)
    res[i].returns = compute_typeinfo(trace[trace.length-1])
  })

  return res
}

describe("combine_types", () => {
  it("should deduplicate primitives", () => {
    let res = combine_types([0, 0].map(compute_typeinfo))
    assert.equal("number", res.toUnique())
  })

  it("should union primitives", () => {
    let res = combine_types([0, "a"].map(compute_typeinfo))
    assert.equal("number|string", res.toUnique())
  })

  it("should combine arrays", () => {
    let res = combine_types([[0], ["a"]].map(e => compute_typeinfo(e)))
    assert.equal("(number|string)[]", res.toUnique())
    
  })

  it("should combine tuples", () => {
    
  })

  it("should combine alike objects", () => {
    
  })

  it("should not combine dissimilar objects", () => {
    
  })

  it("should handle complex combinations", () => {
    
  })
})



describe("combine_traces", () => {
  it("simple combine", () => {
    let res = combine_traces(make_traces(
      [0, true, [0, 0, 0, 0, 0, 0], "a"],
      [0, true, [0, 0, 0, 0, 0, 0], "a"]))

    assert.equal("[number,boolean],[number],string", res.toUnique())
  })

  it("simple combine no yield", () => {
    let res = combine_traces(make_traces(
      [0, true, [], "a"],
      [0, true, [], "a"]))

    assert.equal("[number,boolean],[],string", res.toUnique())
  })

  it("should work with a simple generic", () => {
    let res = combine_traces(make_traces(
      [0, [], 0],
      ["a", [], "a"]))

    assert.equal("[T0],[],T0", res.toUnique())
  })

  it("should parametrize elements of arrays", () => {
    
  })

  it("should handle nested arrays", () => {
    
  })

  it("should recognize tuples", () => {
    
  })
  
  it("should parametrize elements of tuples", () => {
    
  })

  it("should handle nesting in tuples", () => {
    
  })

  it("should parametrize properties of objects", () => {
    
  })

  it("should handle nesting in objects", () => {
    
  })
})


