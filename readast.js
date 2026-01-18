import * as acorn from "acorn"
console.dir(acorn.parse(process.argv[2], {ecmaVersion:"latest", sourceType:"module"}), {depth:null})




