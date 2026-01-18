import { ts, Project, Node } from "ts-morph"
import fs from "node:fs"
import { calls } from "../instrument/trace.ts"
import { combine_traces, combine_types } from "../typeinfo/combine.ts"


export function transform(filename: string) {
  const project = new Project()
  const source = project.createSourceFile(filename, fs.readFileSync(filename).toString(), {overwrite: true})
  const indentation = source.getIndentationText()

  const node_location_map: WeakMap<Node, string> = new WeakMap()

  source.forEachDescendant((node, _traversal) => {
    if (!(
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    )) return

    node_location_map.set(node, `${filename}:${node.getStart(true)}`)
      
  })

  
  source.forEachDescendant((node, _traversal) => {
    if (!(
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    )) return

    const location = node_location_map.get(node)
    if (location === undefined || calls[location] === undefined) return node // we haven't annotated
    let trace = combine_traces(calls[location].traces)
    let level = node.getIndentationLevel()
    
    let i=0
    node.getParameters().forEach((param, i) => {
      // TODO: if we're array destructuring do something
      
      param.setType(trace.args[i].toTypeString(indentation, level))
    })

    // set return type
    // TODO: do generators
    if (trace.yields.length !== 0) {
      let gen = [combine_types(trace.yields).toTypeString(indentation, level)]
      if (trace.returns.type !== "undefined") gen.push(trace.returns.toTypeString(indentation, level))
      node.setReturnType(`Generator<${gen.join(", ")}>`)
      return
    }

    if (trace.returns.type !== "undefined") node.setReturnType(trace.returns.toTypeString(indentation, level))
    // }

  })
  

  return source.getFullText()
}

