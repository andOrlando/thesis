//https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
import ts from "typescript"
import { readFileSync } from "fs"
import { calls } from "../instrument/trace.ts"
import { combine_traces } from "../typeinfo/combine.ts"

const transformer = <T extends ts.Node>(context: ts.TransformationContext) => (root: T) => {
  const source = root.getSourceFile()
  const filename = source.fileName
  
  function visit(node: ts.Node) {
    node = ts.visitEachChild(node, visit, context)
    
    if ([
      ts.SyntaxKind.FunctionDeclaration,
      ts.SyntaxKind.FunctionExpression,
      ts.SyntaxKind.ArrowFunction,
      ts.SyntaxKind.MethodDeclaration,
      ts.SyntaxKind.Constructor,
      ts.SyntaxKind.GetAccessor,
      ts.SyntaxKind.SetAccessor
    ].includes(node.kind)) {
        // has this function been seen before
        
        const location = `${filename}:${node.getStart(source, true)}`
        if (calls[location] === undefined) return node // we haven't annotated
        let trace = combine_traces(calls[location].traces)

        const parameters = (node as ts.FunctionLikeDeclarationBase).parameters
        const newparameters: ts.ParameterDeclaration[] = []
        
        let i=0;
        for (const param of parameters) {
          
          // if our parameter is destructured we have to do our types in the fancy way
          newparameters.push(ts.factory.updateParameterDeclaration(
            param,
            param.modifiers,
            param.dotDotDotToken,
            param.name,
            param.questionToken,
            trace.args[i++].toAst(),
            param.initializer
          ))
        }
        

        const newreturn = trace.returns.type !== "undefined" ? trace.returns.toAst() : undefined
        
        
        if (ts.isFunctionDeclaration(node))
          return ts.factory.updateFunctionDeclaration(node,
            node.modifiers,
            node.asteriskToken, 
            node.name,
            node.typeParameters, // TODO: use generics
            newparameters,
            newreturn,
            node.body)

        if (ts.isFunctionExpression(node))
            return ts.factory.updateFunctionExpression(node,
              node.modifiers,
              node.asteriskToken, 
              node.name,
              node.typeParameters, // TODO: use generics
              newparameters,
              newreturn,
              node.body)
        if (ts.isArrowFunction(node))
            return ts.factory.updateArrowFunction(node,
              node.modifiers,
              node.typeParameters, // TODO: use generics
              newparameters,
              newreturn,
              node.equalsGreaterThanToken,
              node.body)
        if (ts.isMethodDeclaration(node))
            return ts.factory.updateMethodDeclaration(node,
              node.modifiers,
              node.asteriskToken, 
              node.name,
              node.questionToken,
              node.typeParameters, // TODO: use generics
              newparameters,
              newreturn,
              node.body)
        if (ts.isConstructorDeclaration(node))
            return ts.factory.updateConstructorDeclaration(node,
              node.modifiers,
              newparameters,
              node.body)
        if (ts.isGetAccessor(node))
            return ts.factory.updateGetAccessorDeclaration(node,
              node.modifiers,
              node.name,
              newparameters,
              newreturn,
              node.body)
        if (ts.isSetAccessor(node))
            return ts.factory.updateSetAccessorDeclaration(node,
              node.modifiers,
              node.name,
              newparameters,
            node.body)
       
    }

    return node
  }

  return ts.visitNode(root, visit)
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
export function transform(filename: string) {
  let source = ts.createSourceFile(filename, readFileSync(filename).toString(), ts.ScriptTarget.ES2024)
  let res = ts.transform(source, [transformer])

  return printer.printFile(res.transformed[0] as ts.SourceFile)
  
}


