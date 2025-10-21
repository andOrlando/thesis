import * as acorn from "acorn"
import * as walk from "acorn-walk"
import * as astring from "astring"

const uuid_underscore = () => {
  let s = crypto.randomUUID().replace(/-/g, "_")
  return "a"+s.substring(1)
}
const callid_varname = uuid_underscore()

function make_expression_body(node: acorn.Function) {
  const exp: acorn.Expression = node.body as acorn.Expression
  node.expression = true;
  node.body = {
    type: "BlockStatement",
    body: [{
      type: "ReturnStatement",
      argument: exp
    } as acorn.ReturnStatement]
  } as acorn.BlockStatement
}

function make_call_expression(logtype: "__logarg"|"__logret"|"__logyield"|"__logdelyield", params: acorn.Expression[]): acorn.CallExpression {
  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: {
        type: "Identifier",
        name: "global"
      } as acorn.Identifier,
      property: {
        type: "Identifier",
        name: logtype
      } as acorn.Identifier,
      computed: false,
      optional: false
    } as acorn.MemberExpression,
    arguments: params,
    optional: false
  } as acorn.CallExpression
}


function instrument_body(node: acorn.Function, path: string) {

  // we can make this type assertion because all expressions we've turned into bodies
  if (node.body.type !== "BlockStatement")
    throw new Error("Saw a non-block node type in function body")

  const body: acorn.BlockStatement = node.body
  const location = `${path}:${node.start}`
  
  const uuids = node.params.map(uuid_underscore)


  // we need to handle array destructures seperately because we want to know
  // 1. the types of all the named variables
  // 2. the types of all the rest of the array, if it exists
  // so we need to pass in everything to logarg
  // 
  // function dog([[a, b], ...c]) {}
  // becomes
  // function dog(<uuid>) {
  //   let [[<uuid1>, <uuid2>, ...<uuid3>], ...<uuid4>] = <uuid>
  //   let [[{ a, b }, b], c] = __logarg(<uuid1>, <uuid2>, <uuid3>, <uuid4>)
  // }
  const uuids_expanded: string[] = []
  function visit_arrays(p: acorn.ArrayPattern, uuids: string[]): acorn.ArrayPattern {
    let elems: (acorn.ArrayPattern | acorn.Identifier | acorn.RestElement)[] = []
    for (const elem of p.elements) {
      if (elem == null) continue
      if (elem.type === "ArrayPattern") elems.push(visit_arrays(elem, uuids))
      else {
        let uuid = uuid_underscore()
        uuids.push(uuid)
        elems.push({
          type: "Identifier",
          name: uuid
        } as acorn.Identifier)
      }
    }
    // if the last one isn't a rest element we have to append a made-up rest element
    // we'll have to take this into account when processing the destructured array as well
    if (p.elements.length > 0 && p.elements[p.elements.length-1]?.type != "RestElement") {
      let uuid = uuid_underscore()
      uuids.push(uuid)
      elems.push({
        type: "RestElement",
        argument: {
          type: "Identifier",
          name: uuid
        } as acorn.Identifier
      } as acorn.RestElement)
    }

    return {
      type: "ArrayPattern",
      elements: elems
    } as acorn.ArrayPattern
  }
  
  let destructure_assignments = node.params.map((param, i) => {
    if (param.type !== "ArrayPattern") {
      uuids_expanded.push(uuids[i])
      return
    }

    // push to body a destructure statement and construct our uuids_expanded
    let assignee = visit_arrays(param, uuids_expanded)

    // add an assignment to the body, left = uuid
    return {
      type: "VariableDeclaration",
      declarations: [
        {
          type: "VariableDeclarator",
          id: assignee,
          init: {
            type: "Identifier",
            name: uuids[i]
          } as acorn.Identifier
        } as acorn.VariableDeclarator
      ],
      kind: "let",
    } as acorn.VariableDeclaration
  })

  // add the destructuring statements to the body
  // those are the let [[<uuid1>, <uuid2>, ...<uuid3>], ...<uuid4>] = <uuid>
  
  // destructure patterns should have the original patterns
  // this is the part that goes on the left half of the assignment, in [param1, param2]
  const destructure_patterns: acorn.Pattern[] = node.params.map(a => {
    if (a.type == "AssignmentPattern") return a.left
    return a
  })
  
  // right hand of the assignment, __logarg(...uuids)
  // we want to expand the uuids of array destructures
  body.body.unshift({
    type: "VariableDeclaration",
    kind: "let",
    declarations: [{
      type: "VariableDeclarator",
      id: {
        type: "ArrayPattern",
        elements: [
          {
            type: "Identifier",
            name: callid_varname
          } as acorn.Identifier,
          ...destructure_patterns
        ]
      } as acorn.ArrayPattern,
      init: make_call_expression("__logarg", [
        {
          type: "Literal",
          value: location,
          raw: `"${location}"`
        } as acorn.Literal,
        ...uuids_expanded.map(a => ({ type: "Identifier", name: a } as acorn.Identifier))
      ])
    } as acorn.VariableDeclarator]
  } as acorn.VariableDeclaration)

  destructure_assignments.forEach(a => a ? body.body.unshift(a) : undefined)

  // update the params
  node.params = node.params.map((a, i) => {
    if (a.type == "AssignmentPattern") return {
      type: "AssignmentPattern",
      left: {
        type: "Identifier",
        name: uuids[i]
      } as acorn.Identifier,
      right: a.right
    } as acorn.AssignmentPattern

    return {
      type: "Identifier",
      name: uuids[i]
    } as acorn.Identifier
  })
  
  // annotate yields and returns but cease annotating if we see an inner function
  walk.recursive(body, undefined, {
    // do nothing when we see a function
    Function: () => {},

    ReturnStatement(node: acorn.ReturnStatement, _state, _callback) {
      const arg = node.argument ?? {
        type: "Identifier",
        name: "undefined"
      } as acorn.Identifier
      node.argument = make_call_expression("__logret", [
        {
          type: "Literal",
          value: location,
          raw: `"${location}"`
        } as acorn.Literal,
        {
          type: "Identifier",
          name: callid_varname,
        } as acorn.Identifier,
        arg
      ])
    },
    YieldExpression(node: acorn.YieldExpression, _state, _callback) {
      const arg = node.argument ?? {
        type: "Identifier",
        name: "undefined"
      } as acorn.Identifier
      // we also have delegate, yield* Iterator which we have to handle
      // TODO lol
      node.argument = make_call_expression(node.delegate ? "__logdelyield" : "__logyield", [
        {
          type: "Identifier",
          name: callid_varname,
        } as acorn.Identifier,
        arg
      ])
    }
  })

  // if the last element of the body isn't a return statement, add one
  // this could be unreachable if there's an exhaustive branch but this doesn't add much overhead
  if (body.body[body.body.length-1].type !== "ReturnStatement") {
    body.body.push({
      type: "ReturnStatement",
      argument: make_call_expression("__logret", [
        {
          type: "Literal",
          value: location,
          raw: `"${location}"`
        } as acorn.Literal,
        {
          type: "Identifier",
          name: callid_varname,
        } as acorn.Identifier,
        {
          type: "Identifier",
          name: "undefined"
        } as acorn.Identifier,
      ])
    } as acorn.ReturnStatement)
  }
}

export function instrument(source: string, path: string): string {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" })

  walk.simple(ast, {
    Function(node: acorn.Function) {
      // if we have an expression function, give it a body so we can add instrumentation
      if (node.expression) make_expression_body(node)

      // add profiling for args, returns, yeilds
      instrument_body(node, path)
    },
    // AssignmentExpression(node: acorn.AssignmentExpression) {
      // profile assignments too?
    // }
    
  })
  
  return astring.generate(ast)
}






