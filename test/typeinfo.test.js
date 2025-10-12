import { describe, it } from "node:test"
import assert from "node:assert"
import { compute_typeinfo, PrimitiveTI, ObjectTI } from "../typeinfo/types.ts"


describe("type to typeinfo", () => { 
  it("should handle primitives", () => {
    assert.equal(compute_typeinfo(3).toString(), new PrimitiveTI(3).toString())
  })

  it("should handle functions", () => {
    

  })

  it("should handle objects", () => {
    console.log(compute_typeinfo({ a: 1, b: "hi" }))
    assert.equal("{a:number,b:string}", compute_typeinfo({ a: 1, b: "hi" }).toString())
  })

  it("should handle nested objects", () => {
    assert.equal("{a:{b:number}}", compute_typeinfo({ a: {b: 1} }).toString())
  })

  it("should handle top-level cyclical objects", () => {
    let o = {}
    o.o = o
    assert.equal("<ref *0>{o:<Circular *0>}", compute_typeinfo(o).toString())
  })

  it("should handle non-top-level cyclical objects", () => {
    let o = {}
    o.O = {}
    o.O.o = o.O
    assert.equal("{O:<ref *0>{o:<Circular *0>}}", compute_typeinfo(o).toString())
  })
})

describe("trace hashing")
