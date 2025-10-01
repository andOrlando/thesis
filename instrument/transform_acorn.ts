import * as acorn from "acorn"
import * as walk from "acorn-walk"
import * as astring from "astring"

const uuid_underscore = () => crypto.randomUUID().replace(/-/g, "_")
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
  
  // args should just have the uuids and assignments
  const uuids = node.params.map(uuid_underscore)
  const param_patterns: acorn.Pattern[] = node.params.map((a, i) => {
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

  // destructure patterns should have the original patterns
  const destructure_patterns: acorn.Pattern[] = node.params.map(a => {
    if (a.type == "AssignmentPattern") return a.left
    return a
  })
  
  // add call statement to body
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
        ...uuids.map(a => ({ type: "Identifier", name: a } as acorn.Identifier))
      ])
    } as acorn.VariableDeclarator]
  } as acorn.VariableDeclaration)

  // update the params
  node.params = param_patterns
  
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

export function transform(source: string, path: string): string {
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






