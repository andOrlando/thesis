import * as acorn from "acorn"
import * as astring from "astring"
import tsPlugin from 'acorn-typescript'

let p = acorn.Parser(tsPlugin({ dst: true})).parse(process.argv[2], {ecmaVersion:"latest", sourceType:"module", location: true})
console.dir(p, {depth:null})

console.log(astring.generate(p))



