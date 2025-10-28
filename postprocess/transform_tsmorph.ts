import { ts, Project, Node } from "ts-morph"
import fs from "node:fs"
import { calls } from "../instrument/trace.ts"
import { combine_traces, combine_types } from "../typeinfo/combine.ts"


export function transform(filename: string) {
  const project = new Project()
  const source = project.createSourceFile(filename, fs.readFileSync(filename).toString(), {overwrite: true})
  const indentation = source.getIndentationText()

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

    const location = `${filename}:${node.getStart(true)}`
    if (calls[location] === undefined) return node // we haven't annotated
    let trace = combine_traces(calls[location].traces)
    let level = node.getIndentationLevel()
    
    let i=0
    node.getParameters().forEach((param, i) => {
      // TODO: if we're array destructuring do something
      
      param.setType(trace.args[i].toTypeString(indentation, level))
    })

    if (!(Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node))) {
        // TODO: do generators
      if (trace.yields.length !== 0) {
        let gen = [combine_types(trace.yields).toTypeString(indentation, level)]
        if (trace.returns.type !== "undefined") gen.push(trace.returns.toTypeString(indentation, level))
        node.setReturnType(`Generator<${gen.join(", ")}>`)
        return
      }

      if (trace.returns.type !== "undefined") node.setReturnType(trace.returns.toTypeString(indentation, level))
    }

  })
  
  // source.transform(traversal => {
  //   let node = traversal.visitChildren()
    
  //   if ([
  //     ts.SyntaxKind.FunctionDeclaration,
  //     ts.SyntaxKind.FunctionExpression,
  //     ts.SyntaxKind.ArrowFunction,
  //     ts.SyntaxKind.MethodDeclaration,
  //     ts.SyntaxKind.Constructor,
  //     ts.SyntaxKind.GetAccessor,
  //     ts.SyntaxKind.SetAccessor
  //   ].includes(node.kind)) {
  //       // has this function been seen before
        
  //       const location = `${filename}:${node.getStart(traversal.currentNode.getSourceFile(), true)}`
  //       if (calls[location] === undefined) return node // we haven't annotated
  //       let trace = combine_traces(calls[location].traces)

  //       const parameters = (node as ts.FunctionLikeDeclarationBase).parameters
  //       const newparameters: ts.ParameterDeclaration[] = []
        
  //       let i=0;
  //       for (const param of parameters) {
          
  //         // TODO: if our parameter is destructured we have to do our types in the fancy way
  //         newparameters.push(ts.factory.updateParameterDeclaration(
  //           param,
  //           param.modifiers,
  //           param.dotDotDotToken,
  //           param.name,
  //           param.questionToken,
  //           trace.args[i++].toAst(),
  //           param.initializer
  //         ))
  //       }
        

  //       const newreturn = trace.returns.type !== "undefined" ? trace.returns.toAst() : undefined
        
  //       if (ts.isFunctionDeclaration(node))
  //         return ts.factory.updateFunctionDeclaration(node,
  //           node.modifiers,
  //           node.asteriskToken, 
  //           node.name,
  //           node.typeParameters, // TODO: use generics
  //           newparameters,
  //           newreturn,
  //           node.body)

  //       if (ts.isFunctionExpression(node))
  //           return ts.factory.updateFunctionExpression(node,
  //             node.modifiers,
  //             node.asteriskToken, 
  //             node.name,
  //             node.typeParameters, // TODO: use generics
  //             newparameters,
  //             newreturn,
  //             node.body)
  //       if (ts.isArrowFunction(node))
  //           return ts.factory.updateArrowFunction(node,
  //             node.modifiers,
  //             node.typeParameters, // TODO: use generics
  //             newparameters,
  //             newreturn,
  //             node.equalsGreaterThanToken,
  //             node.body)
  //       if (ts.isMethodDeclaration(node))
  //           return ts.factory.updateMethodDeclaration(node,
  //             node.modifiers,
  //             node.asteriskToken, 
  //             node.name,
  //             node.questionToken,
  //             node.typeParameters, // TODO: use generics
  //             newparameters,
  //             newreturn,
  //             node.body)
  //       if (ts.isConstructorDeclaration(node))
  //           return ts.factory.updateConstructorDeclaration(node,
  //             node.modifiers,
  //             newparameters,
  //             node.body)
  //       if (ts.isGetAccessor(node))
  //           return ts.factory.updateGetAccessorDeclaration(node,
  //             node.modifiers,
  //             node.name,
  //             newparameters,
  //             newreturn,
  //             node.body)
  //       if (ts.isSetAccessor(node))
  //           return ts.factory.updateSetAccessorDeclaration(node,
  //             node.modifiers,
  //             node.name,
  //             newparameters,
  //           node.body)
       
  //   }

  //   return node
  // })
  return source.getFullText()
}

