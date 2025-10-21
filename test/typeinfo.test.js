import { describe, it } from "node:test"
import assert from "node:assert"
import { compute_typeinfo, PrimitiveTI, ObjectTI } from "../typeinfo/types.ts"


describe("type to typeinfo", () => { 
  it("should handle primitives", () => {
    assert.equal(compute_typeinfo(3).toUnique(), new PrimitiveTI(3).toUnique())
  })

  it("should handle functions", () => {
    

  })

  it("should handle objects", () => {
    assert.equal("{a:number,b:string}", compute_typeinfo({ a: 1, b: "hi" }).toUnique())
  })

  it("should handle nested objects", () => {
    assert.equal("{a:{b:number}}", compute_typeinfo({ a: {b: 1} }).toUnique())
  })

  it("should handle top-level cyclical objects", () => {
    let o = {}
    o.o = o
    assert.equal("<ref *0>{o:<Circular *0>}", compute_typeinfo(o).toUnique())
  })

  it("should handle non-top-level cyclical objects", () => {
    let o = {}
    o.O = {}
    o.O.o = o.O
    assert.equal("{O:<ref *0>{o:<Circular *0>}}", compute_typeinfo(o).toUnique())
  })
})

describe("trace hashing")
