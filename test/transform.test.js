import { describe, it } from "node:test"
import assert from "node:assert"
import { transform } from "../instrument/transform_acorn.ts"
import dedent from "dedent-js"

// literal + regex + dedent
function litd(parts, ...rxps) {
  return new RegExp(
    dedent(parts.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .map((s, i) => s + (rxps[i] ? rxps[i].source : ""))
      .join(""))
  );
}
const uuid = /[_\w\d]{36}/


describe("transform_acorn", () => {
  it("should instrument function definitions", () => {
    const res = transform("function dog() { return 'dog' }", "file")

    // should see log for arg and ret
    assert.match(res.trim(), litd`
    function dog() {
      let [${uuid}] = global.__logarg("file:0");
      return global.__logret("file:0", ${uuid}, 'dog');
    }`)
  })

  it("should instrument nested functions correctly", () => {
    const res = transform(dedent(`
    function dog() {
      function dog2() {
        return "dog2";
      }
      return dog2();
    }`), "file")

    assert.match(res.trim(), litd`
    function dog() {
      let [${uuid}] = global.__logarg("file:0");
      function dog2() {
        let [${uuid}] = global.__logarg("file:19");
        return global.__logret("file:19", ${uuid}, "dog2");
      }
      return global.__logret("file:0", ${uuid}, dog2());
    }`)
  })

  it("should instrument for multiple arguments", () => {
    const res = transform("function dog(a, b) { return a + b }", "file")
    assert.match(res.trim(), litd`
    function dog(${uuid}, ${uuid}) {
      let [${uuid}, a, b] = global.__logarg("file:0", ${uuid}, ${uuid});
      return global.__logret("file:0", ${uuid}, a + b);
    }`)
  })

  it("should instrument functions without returns", () => {
    const res = transform("function dog() {}", "file")
    assert.match(res.trim(), litd`
    function dog() {
      let [${uuid}] = global.__logarg("file:0");
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle array destructuring", () => {
    const res = transform("function dog([a, b]) {}", "file")
    assert.match(res.trim(), litd`
    function dog(${uuid}) {
      let [${uuid}, [a, b]] = global.__logarg("file:0", ${uuid});
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle object destructuring", () => {
    const res = transform("function dog({a, b}) {}", "file")
    assert.match(res.trim(), litd`
    function dog(${uuid}) {
      let [${uuid}, {a, b}] = global.__logarg("file:0", ${uuid});
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle nested array destructuring", () => {
    const res = transform("function dog([a, [b, c]]) {}", "file")
    assert.match(res.trim(), litd`
    function dog(${uuid}) {
      let [${uuid}, [a, [b, c]]] = global.__logarg("file:0", ${uuid});
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle nested object destructuring", () => {
    const res = transform("function dog({a: {b, c}}) {}", "file")
    assert.match(res.trim(), litd`
    function dog(${uuid}) {
      let [${uuid}, {a: {b, c}}] = global.__logarg("file:0", ${uuid});
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })
  
  it("should handle assignment", () => {
    const res = transform("function dog(a = 5) {}", "file")
    assert.match(res.trim(), litd`
    function dog(${uuid} = 5) {
      let [${uuid}, a] = global.__logarg("file:0", ${uuid});
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle assignment with non-identifiers", () => {
    const res = transform("function dog({a, b} = {a: 5, b: 5}) {}", "file")
    // weird formatting is astring's default output
    assert.match(res.trim(), litd`
    function dog(${uuid} = {
      a: 5,
      b: 5
    }) {
      let [${uuid}, {a, b}] = global.__logarg("file:0", ${uuid});
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle expression functions", () => {
    const res = transform("dog = () => 'dog'", "file")
    assert.match(res.trim(), litd`
    dog = () => {
      let [${uuid}] = global.__logarg("file:6");
      return global.__logret("file:6", ${uuid}, 'dog');
    };`)
  })

  it("should handle yeilds", () => {
    const res = transform("function* dog() { yield 5; return undefined }", "file")
    assert.match(res.trim(), litd`
    function* dog() {
      let [${uuid}] = global.__logarg("file:0");
      yield global.__logyield(${uuid}, 5);
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })

  it("should handle delegate yields", () => {
    const res = transform("function* dog() { yield* [5]; return undefined }", "file")
    assert.match(res.trim(), litd`
    function* dog() {
      let [${uuid}] = global.__logarg("file:0");
      yield* global.__logdelyield(${uuid}, [5]);
      return global.__logret("file:0", ${uuid}, undefined);
    }`)
  })
})
