import { describe, it } from "node:test"
import assert from "node:assert"

import { compute_typeinfo, Trace, TupleTI } from "../typeinfo/types.ts"
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
    let res = combine_types([
      new TupleTI([0, 0, 0].map(e => compute_typeinfo(e))),
      new TupleTI(["a", "a", "a"].map(e => compute_typeinfo(e)))])
    assert.equal("[number|string, number|string, number|string]", res.toTypeString())
  })

  it("should combine tuples of varying lengths", () => {
    let res = combine_types([
      new TupleTI([0, 0].map(e => compute_typeinfo(e))),
      new TupleTI(["a", "a"].map(e => compute_typeinfo(e))),
      new TupleTI([0, 0, 0].map(e => compute_typeinfo(e))),
      new TupleTI(["a", "a", "a"].map(e => compute_typeinfo(e)))])
    assert.equal("[number|string, number|string]|[number|string, number|string, number|string]", res.toTypeString())
  })

  it("should combine alike objects", () => {
    let res = combine_types([{a: 1, b: 2}, {a: 1, c: 3}].map(e => compute_typeinfo(e)))
    assert.equal("{ a: number, b?: number, c?: number }", res.toTypeString())
  })

  it("should not combine dissimilar objects", () => {
    let res = combine_types([{a: 1}, {b: 1}].map(e => compute_typeinfo(e)))
    assert.equal("{ a: number }|{ b: number }", res.toTypeString())
  })

  it("should handle complex combinations", () => {
    let res = combine_types([
      1,
      "hi",
      [0, 0, 0, 0],
      {a: 1},
      {a: 1, b: 1}
    ].map(e => compute_typeinfo(e)).concat([
      new TupleTI([0, 0].map(e => compute_typeinfo(e))),
      new TupleTI(["a", "a"].map(e => compute_typeinfo(e)))
    ]))
    assert.equal("number|string|number[]|{ a: number, b?: number }|[number|string, number|string]", res.toTypeString())
  })
})



describe("combine_traces", () => {
  it("simple combine", () => {
    let [res, _g] = combine_traces(make_traces(
      [0, true, [0, 0, 0, 0, 0, 0], "a"],
      [0, true, [0, 0, 0, 0, 0, 0], "a"]))

    assert.equal("[number,boolean],[number],string", res.toUnique())
  })

  it("simple combine no yield", () => {
    let [res, _g] = combine_traces(make_traces(
      [0, true, [], "a"],
      [0, true, [], "a"]))

    assert.equal("[number,boolean],[],string", res.toUnique())
  })

  it("should work with a simple generic", () => {
    let [res, g] = combine_traces(make_traces(
      [0, [], 0],
      ["a", [], "a"]))

    assert.equal("[T0],[],T0", res.toUnique())
    assert.equal("number|string", g[0].toTypeString())
  })

  it("should parametrize elements of arrays", () => {
    let [res, g] = combine_traces(make_traces(
      [[0, 0, 0, 0, 0, 0], [], 0],
      [["a", "a", "a", "a", "a", "a"], [], "a"]
    ))

    assert.equal("[(T0)[]],[],T0", res.toUnique())
    assert.equal("number|string", g[0].toTypeString())
  })

  it("should handle nested arrays", () => {
    let a = [0, 0, 0, 0, 0, 0]
    let b = ["a", "a", "a", "a", "a", "a"]
    let [res, g] = combine_traces(make_traces(
      [[a, a, a, a, a, a], [], 0],
      [[b, b, b, b, b, b], [], "a"]
    ))
    
    assert.equal("[((T0)[])[]],[],T0", res.toUnique())
    assert.equal("number|string", g[0].toTypeString())
  })

  it("should recognize tuples", () => {
    let [res, _g] = combine_traces(make_traces(
      [[0, 0, 0], [], 0],
      [[0, 0, 0], [], 0]
    ))

    assert.equal("[[number,number,number]],[],number", res.toUnique())
    
  })
  
  it("should parametrize elements of tuples", () => {
    let [res, g] = combine_traces(make_traces(
      [[0, 0, 0], [], 0],
      [[0, "a", "a"], [], 0]
    ))

    assert.equal("[[number,T0,T0]],[],number", res.toUnique())
    assert.equal("number|string", g[0].toTypeString())
    
  })

  it("should handle nesting in tuples", () => {
    let [res, _g] = combine_traces(make_traces(
      [[[0, 0], 0, 0], [], 0],
      [[[0, 0], 0, 0], [], 0]
    ))

    assert.equal("[[[number,number],number,number]],[],number", res.toUnique())
    
  })

  it("should parametrize properties of objects", () => {
    let [res, g] = combine_traces(make_traces(
      [{a: 0, b: 0}, [], 0],
      [{a: "a", b: 0}, [], "a"]
    ))
    
    assert.equal("[{a:T0,b:number}],[],T0", res.toUnique())
    assert.equal("number|string", g[0].toTypeString())
  })

  it("should handle nesting in objects", () => {
    let [res, g] = combine_traces(make_traces(
      [{a: {a: 0, b: "a"}, b: {b: "a"}}, [], 0],
      [{a: {a: "a", b: 0}, b: {b: 0}}, [], "a"]
    ))

    assert.equal("[{a:{a:T0,b:T1},b:{b:T1}}],[],T0", res.toUnique())
    assert.equal("number|string", g[0].toTypeString())
    assert.equal("string|number", g[1].toTypeString())
  })
})


