import * as ts from "typescript";
import {
    findNodeAtPosition,
    getCommentsFromDeclaration,
    getCommentsFromNode,
    getSymbolAtNode,
    isDeclarationDeprecated,
    isNodeDeprecated,
    isSupportedFileType,
    isSymbolDeprecated
} from "./utils";
import { Diagnostic } from "typescript";

/**
 *
 * @param node
 * @param symbol
 * @param sourceFile
 * @param priorDiagnostics
 * @param log
 * @param declarationOverride  - allows us to override the declaration of the symbol if the deprecation was found elsewhere
 * @returns
 */
const createDeprecatedDiagnostic = (
    node: ts.Node,
    symbol: ts.Symbol,
    sourceFile: ts.SourceFile,
    priorDiagnostics: Diagnostic[],
    log: (message: string) => void,
    declarationOverride?: ts.NamedDeclaration
): Diagnostic | null => {
    log(`Creating diagnostic for deprecated symbol: ${symbol.getName()} - ${node.getText()}`);

    const diagnosticStart = node.getStart();
    const diagnosticEnd = node.getEnd() - node.getStart();
    const diagnosticCode = 6385; // Deprecated code

    const declaration = declarationOverride || symbol.getDeclarations()[0];
    const deprecationSourceStart = declaration.getStart();
    const deprecationSourceEnd = declaration.getEnd();
    const deprecationSourceFile = declaration.getSourceFile();

    const alreadyReported = priorDiagnostics.some(
        diagnostic =>
            diagnostic.start === diagnosticStart &&
            diagnostic.length === diagnosticEnd &&
            diagnostic.code === diagnosticCode
    );

    if (!alreadyReported) {
        log(`Adding diagnostic for deprecated symbol: ${symbol.getName()}`);
        return {
            file: sourceFile,
            start: diagnosticStart,
            length: diagnosticEnd,
            messageText: `'${symbol.getName()}' is deprecated.`,
            category: ts.DiagnosticCategory.Warning,
            reportsDeprecated: true,
            code: diagnosticCode,
            relatedInformation: [
                {
                    start: deprecationSourceStart,
                    length: deprecationSourceEnd - deprecationSourceStart,
                    file: deprecationSourceFile,
                    messageText: "The declaration was marked as deprecated here.",
                    category: ts.DiagnosticCategory.Error,
                    code: 2798
                }
            ]
        };
    }
    return null;
};

// Helper function to create detailed deprecation message for QuickInfo
const createDeprecatedQuickInfoTag = (symbol: ts.Symbol, checker: ts.TypeChecker): ts.JSDocTagInfo | null => {
    const declaration = symbol.getDeclarations()[0];
    const sourceFile = declaration.getSourceFile();
    const start = declaration.getStart();
    const end = declaration.getEnd();

    return {
        name: "deprecated",
        text: [
            {
                kind: "text",
                text: `Symbol '${symbol.getName()}' is deprecated.`
            },
            {
                kind: "space",
                text: " "
            },
            {
                kind: "text",
                text: `Declared in ${sourceFile.fileName} at line ${
                    sourceFile.getLineAndCharacterOfPosition(start).line + 1
                }.`
            }
        ]
    };
};

// Traverse imports and re-exports to resolve and check for deprecations
const isImportDeclarationDeprecated = (
    currentNode: ts.Node,
    checker: ts.TypeChecker,
    log: (message: string) => void,
    program: ts.Program
) => {
    // Get the import node for the current node
    let node = currentNode;

    // Handle Import Declarations
    if (ts.isImportDeclaration(node)) {
        log(`[IMPORT] Checking import declaration: ${node.getText()}`);
        const importClause = node.importClause;
        if (importClause && importClause.namedBindings) {
            const namedBindings = importClause.namedBindings;
            if (ts.isNamedImports(namedBindings)) {
                const moduleSpecifier = node.moduleSpecifier as ts.StringLiteral;

                const moduleName = moduleSpecifier.text;
                const sourceFile = node.getSourceFile();

                log(`[IMPORT] Resolving module specifier: "${moduleName}" from "${sourceFile.fileName}"`);

                // Resolve the module to get the file name
                const resolvedModule = ts.resolveModuleName(
                    moduleName,
                    sourceFile.fileName,
                    program.getCompilerOptions(),
                    ts.sys
                );

                if (resolvedModule.resolvedModule) {
                    const resolvedFileName = resolvedModule.resolvedModule.resolvedFileName;
                    log(`[IMPORT] Resolved module "${moduleName}" to "${resolvedFileName}"`);

                    // Skip node_modules
                    if (resolvedFileName.includes("node_modules")) {
                        log(`[IMPORT] Skipping node_modules`);
                        return null;
                    }

                    const moduleSourceFile = program.getSourceFile(resolvedFileName);

                    if (moduleSourceFile) {
                        // Get the module symbol from the source file
                        const moduleSymbol = checker.getSymbolAtLocation(moduleSourceFile);

                        if (moduleSymbol) {
                            const exports = checker.getExportsOfModule(moduleSymbol);
                            log(
                                `[IMPORT] Found ${exports.length} exports in module "${
                                    moduleSourceFile.getSourceFile().fileName
                                }"`
                            );

                            for (const element of namedBindings.elements) {
                                const importName = element.name.text;
                                const exportSymbol = exports.find(s => s.name === importName);
                                const exportSymbolDeclaration = exportSymbol?.getDeclarations()?.[0];

                                /**
                                 * Check if the parent node of the export symbol is deprecated.
                                 */
                                let exportSymbolParent = exportSymbolDeclaration?.parent;
                                while (exportSymbolParent && !ts.isSourceFile(exportSymbolParent)) {
                                    const isExportSymbolParentDeprecated = isNodeDeprecated(
                                        checker,
                                        exportSymbolParent
                                    );
                                    log(`[IMPORT] Parent node is deprecated: ${isExportSymbolParentDeprecated}`);
                                    if (isExportSymbolParentDeprecated) {
                                        let importNode = undefined;
                                        node.forEachChild(child => {
                                            log(`[IMPORT] Child: ${child.getText()}`);
                                            child.forEachChild(namedImport => {
                                                log(`[IMPORT] Named Import: ${namedImport.getText()}`);
                                                namedImport.forEachChild(importSpec => {
                                                    log(`[IMPORT] Import Specifier: ${importSpec.getText()}`);
                                                    if (importSpec.getText() === importName) {
                                                        importNode = importSpec;
                                                    }
                                                });
                                            });
                                        });

                                        return createDeprecatedDiagnostic(
                                            importNode,
                                            exportSymbol,
                                            exportSymbolDeclaration.getSourceFile(),
                                            [],
                                            log,
                                            exportSymbolDeclaration
                                        );
                                    }
                                    exportSymbolParent = exportSymbolParent?.parent;
                                }

                                if (exportSymbol) {
                                    log(
                                        `[IMPORT] Checking export "${importName}" in module "${
                                            moduleSourceFile.getSourceFile().fileName
                                        }"`
                                    );
                                    const declarations = exportSymbol.getDeclarations();
                                    if (declarations && declarations.length > 0) {
                                        const declaration = declarations[0];

                                        const declarationComments = getCommentsFromDeclaration(declaration);
                                        if (declarationComments.length > 0) {
                                            log(
                                                `[IMPORT] Found comments on declaration: ${declarationComments.join(
                                                    "\n"
                                                )}`
                                            );
                                        }

                                        if (isDeclarationDeprecated(declaration)) {
                                            log(`[IMPORT] Import "${importName}" is deprecated in "${moduleName}"`);

                                            // Get the node of the named import within the original node
                                            const importNode = node
                                                .getChildren()
                                                .find(child => ts.isNamedImports(child))
                                                ?.getChildren()
                                                .find(
                                                    child =>
                                                        ts.isImportSpecifier(child) && child.name.text === importName
                                                );

                                            return createDeprecatedDiagnostic(
                                                importNode,
                                                exportSymbol,
                                                node.getSourceFile(),
                                                [],
                                                log,
                                                declaration
                                            );
                                        }
                                    }
                                } else {
                                    log(`[IMPORT] Could not find export "${importName}" in module "${moduleName}"`);
                                }
                            }
                        } else {
                            log(`[IMPORT] Could not get symbol for module "${moduleName}"`);
                        }
                    } else {
                        log(`[IMPORT] Could not get source file for "${resolvedFileName}"`);
                    }
                } else {
                    log(`[IMPORT] Could not resolve module "${moduleName}"`);
                }
            }
        }
    }

    // Handle Export Declarations
    // if (ts.isExportDeclaration(node)) {
    //     log(`[EXPORT] Checking export declaration: ${node.getText()}`);
    //     const exportClause = node.exportClause;

    //     if (exportClause && ts.isNamedExports(exportClause)) {
    //         const moduleSpecifier = node.moduleSpecifier;
    //         let exportedSymbols: ts.Symbol[] = [];

    //         if (moduleSpecifier) {
    //             // Re-exporting from another module
    //             log(`[EXPORT] Module specifier found: ${moduleSpecifier.getText()}`);
    //             const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
    //             if (moduleSymbol) {
    //                 exportedSymbols = checker.getExportsOfModule(moduleSymbol);
    //                 log(`[EXPORT] Found ${exportedSymbols.length} exports in module.`);
    //             }
    //         }

    //         // Handle named exports like `export { X }` or `export { X } from "module"`
    //         for (const element of exportClause.elements) {
    //             const exportName = element.name.text;
    //             log(`[EXPORT] Checking export element: ${exportName}`);

    //             let exportSymbol: ts.Symbol | undefined;

    //             if (moduleSpecifier && exportedSymbols.length > 0) {
    //                 // If re-exporting from a module, find the symbol in the module's exports
    //                 exportSymbol = exportedSymbols.find(s => s.name === exportName);
    //             } else {
    //                 // Otherwise, get the symbol from the local scope
    //                 exportSymbol = checker.getSymbolAtLocation(element.name);
    //             }

    //             if (exportSymbol) {
    //                 const exportDeclaration = exportSymbol.getDeclarations()?.[0];

    //                 // Check parent nodes for deprecation
    //                 let parentNode = exportDeclaration?.parent;
    //                 while (parentNode && !ts.isSourceFile(parentNode)) {
    //                     const isParentDeprecated = isNodeDeprecated(checker, parentNode);
    //                     log(`[EXPORT] Parent node is deprecated: ${isParentDeprecated}`);
    //                     if (isParentDeprecated) {
    //                         return createDeprecatedDiagnostic(
    //                             node,
    //                             exportSymbol,
    //                             node.getSourceFile(),
    //                             [],
    //                             log,
    //                             exportDeclaration
    //                         );
    //                     }
    //                     parentNode = parentNode.parent;
    //                 }

    //                 // Check if the export declaration itself is deprecated
    //                 if (isDeclarationDeprecated(exportDeclaration)) {
    //                     log(`[EXPORT] Export declaration ${exportSymbol.getName()} is deprecated`);
    //                     return createDeprecatedDiagnostic(
    //                         exportDeclaration,
    //                         exportSymbol,
    //                         node.getSourceFile(),
    //                         [],
    //                         log,
    //                         exportDeclaration
    //                     );
    //                 }

    //                 // Check if the symbol is deprecated recursively
    //                 if (isSymbolDeprecatedRecursively(exportSymbol, checker, log)) {
    //                     log(`[EXPORT] Exported symbol ${exportSymbol.getName()} is deprecated recursively`);
    //                     return createDeprecatedDiagnostic(node, exportSymbol, node.getSourceFile(), [], log);
    //                 }
    //             } else {
    //                 log(`[EXPORT] Could not find symbol for export element: ${exportName}`);
    //             }
    //         }
    //     } else if (node.moduleSpecifier) {
    //         // Handle `export * from "module"` (wildcard re-exports)
    //         const moduleSpecifier = node.moduleSpecifier;
    //         log(`[EXPORT] Checking module specifier: ${moduleSpecifier.getText()}`);
    //         const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
    //         if (moduleSymbol) {
    //             const exportedSymbols = checker.getExportsOfModule(moduleSymbol);
    //             log(`[EXPORT] Found ${exportedSymbols.length} exports in module.`);
    //             for (const exportSymbol of exportedSymbols) {
    //                 log(`[EXPORT] Checking re-exported symbol: ${exportSymbol.getName()}`);
    //                 const exportDeclaration = exportSymbol.getDeclarations()?.[0];

    //                 // Check parent nodes for deprecation
    //                 let parentNode = exportDeclaration?.parent;
    //                 while (parentNode && !ts.isSourceFile(parentNode)) {
    //                     const isParentDeprecated = isNodeDeprecated(checker, parentNode);
    //                     log(`[EXPORT] Parent node is deprecated: ${isParentDeprecated}`);
    //                     if (isParentDeprecated) {
    //                         log(`[EXPORT] Re-exported symbol's parent node is deprecated`);
    //                         return createDeprecatedDiagnostic(
    //                             node,
    //                             symbol,
    //                             node.getSourceFile(),
    //                             [],
    //                             log,
    //                             exportDeclaration
    //                         );
    //                     }
    //                     parentNode = parentNode.parent;
    //                 }

    //                 // Check if the export declaration itself is deprecated
    //                 if (isDeclarationDeprecated(exportDeclaration)) {
    //                     log(`[EXPORT] Re-exported symbol ${exportSymbol.getName()} is deprecated`);
    //                     return createDeprecatedDiagnostic(
    //                         node,
    //                         symbol,
    //                         node.getSourceFile(),
    //                         [],
    //                         log,
    //                         exportDeclaration
    //                     );
    //                 }

    //                 // Check if the symbol is deprecated recursively
    //                 if (isSymbolDeprecatedRecursively(exportSymbol, checker, log)) {
    //                     log(`[EXPORT] Re-exported symbol ${exportSymbol.getName()} is deprecated recursively`);
    //                     return createDeprecatedDiagnostic(node, exportSymbol, node.getSourceFile(), [], log);
    //                 }
    //             }
    //         }
    //     }
    // }
};

// Resolve the symbol and follow alias chain to check for deprecations
const isSymbolDeprecatedRecursively = (
    symbol: ts.Symbol,
    checker: ts.TypeChecker,
    log: (message: string) => void
): boolean => {
    let currentSymbol: ts.Symbol | undefined = symbol;
    const visitedSymbols = new Set<ts.Symbol>();

    while (currentSymbol) {
        // Avoid cycles
        if (visitedSymbols.has(currentSymbol)) break;
        visitedSymbols.add(currentSymbol);

        // Check for deprecation in the current symbol
        if (isSymbolDeprecated(currentSymbol)) {
            log(`Symbol ${currentSymbol.getName()} is deprecated.`);
            return true;
        }

        const isAlias = currentSymbol.flags & ts.SymbolFlags.Alias;
        if (!isAlias) {
            break;
        }
        log(`Symbol ${currentSymbol.getName()} is an alias.`);

        const immediateAliasedSymbol = checker.getImmediateAliasedSymbol(currentSymbol);
        if (immediateAliasedSymbol) {
            log(`Immediated alias from ${currentSymbol.getName()} to ${immediateAliasedSymbol.getName()}`);
        }

        // Resolve alias, if present, and continue the loop
        const aliasedSymbol = checker.getAliasedSymbol(currentSymbol);
        if (aliasedSymbol && aliasedSymbol !== currentSymbol) {
            log(`Following alias from ${currentSymbol.getName()} to ${aliasedSymbol.getName()}`);
            currentSymbol = aliasedSymbol;
        } else {
            break;
        }
    }

    return false;
};

// The factory function that TypeScript expects
const init = ({ typescript: ts }) => {
    return {
        create: info => {
            const proxy = Object.create(null);

            const oldLanguageService = info.languageService;
            const oldGetQuickInfoAtPosition = oldLanguageService.getQuickInfoAtPosition;
            const oldGetSemanticDiagnostics = oldLanguageService.getSemanticDiagnostics;
            const oldGetSuggestionDiagnostics = oldLanguageService.getSuggestionDiagnostics;

            // Create a proxy to wrap the language service
            for (let k in oldLanguageService) {
                const x = oldLanguageService[k];
                proxy[k] = (...args) => x.apply(oldLanguageService, args);
            }

            // Logging to TypeScript Server
            const log = (message: string) => {
                // Or use the logger if available
                if (info.project && info.project.projectService && info.project.projectService.logger) {
                    info.project.projectService.logger.info(`[DEPRECATION PLUGIN]: ${message}`);
                } else {
                    console.log(`[DEPRECATION PLUGIN]: ${message}`);
                }
            };

            log("Plugin Initialized - hotloading");

            const checker: ts.TypeChecker | undefined = info.languageService.getProgram()?.getTypeChecker();

            // Hook into the quick info to display tooltips
            // proxy.getQuickInfoAtPosition = (fileName: string, position: number) => {
            //     if (!isSupportedFileType(fileName)) return oldGetQuickInfoAtPosition(fileName, position);

            //     const quickInfo: ts.QuickInfo = oldGetQuickInfoAtPosition(fileName, position);
            //     const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
            //     const node = findNodeAtPosition(sourceFile, position);

            //     if (node && checker) {
            //         const symbol = checker.getSymbolAtLocation(node);
            //         if (symbol && isSymbolDeprecatedRecursively(symbol, checker, log)) {
            //             log(`Deprecated symbol detected: ${symbol.getName()}`);

            //             // Create detailed deprecation message with source information
            //             const deprecationTag = createDeprecatedQuickInfoTag(symbol, checker);
            //             if (deprecationTag) {
            //                 quickInfo.tags = quickInfo.tags || [];
            //                 quickInfo.tags.push(deprecationTag);
            //             }
            //         }
            //     }

            //     return quickInfo;
            // };

            // Common logic for both suggestion and semantic diagnostics
            const checkDiagnostics = (
                fileName: string,
                priorDiagnostics: Diagnostic[],
                category: ts.DiagnosticCategory,
                program = info.languageService.getProgram()
            ) => {
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const diagnostics: Diagnostic[] = [];

                if (sourceFile && checker && isSupportedFileType(fileName)) {
                    log(`Checking ${fileName} for deprecated symbols`);

                    const visit = (node: ts.Node) => {
                        // First we check for imports
                        const deprecatedAliasDiagnostic = isImportDeclarationDeprecated(node, checker, log, program);
                        if (deprecatedAliasDiagnostic) {
                            deprecatedAliasDiagnostic.category = category;
                            diagnostics.push(deprecatedAliasDiagnostic);
                            return;
                        } else if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
                            // This will check for deprecated symbols in the source file by checkin the import declarations using the same logic as above
                            if (node.getText() === "a") {
                                log(`Checking non-import: ${node.getText()}`);

                                // Get symbol at the location of `a`
                                const symbol = checker.getSymbolAtLocation(node);
                                if (symbol) {
                                    log(`Symbol found: ${symbol.getName()}`);

                                    // Find the first declaration associated with the symbol
                                    const declaration = symbol.getDeclarations()?.[0];
                                    if (declaration && ts.isImportSpecifier(declaration)) {
                                        log(`Declaration found in import: ${declaration.getText()}`);

                                        let importDeclaration: ts.Node = declaration;

                                        // Get top-level import declaration
                                        while (importDeclaration.parent) {
                                            if (ts.isImportDeclaration(importDeclaration.parent)) {
                                                importDeclaration = importDeclaration.parent;
                                                break;
                                            }
                                            importDeclaration = importDeclaration.parent;
                                        }

                                        // Check if the import is deprecated
                                        if (ts.isImportDeclaration(importDeclaration)) {
                                            log(`Import parent: ${importDeclaration.getText()}`);

                                            const deprecatedAliasDiagnostic = isImportDeclarationDeprecated(
                                                importDeclaration,
                                                checker,
                                                log,
                                                program
                                            );
                                            if (deprecatedAliasDiagnostic) {
                                                deprecatedAliasDiagnostic.start = node.getStart();
                                                deprecatedAliasDiagnostic.length = node.getEnd() - node.getStart();
                                                diagnostics.push(deprecatedAliasDiagnostic);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        ts.forEachChild(node, visit);
                    };

                    visit(sourceFile);
                }

                return priorDiagnostics.concat(diagnostics);
            };

            // Override suggestion diagnostics
            proxy.getSuggestionDiagnostics = (fileName: string) => {
                const priorDiagnostics = oldGetSuggestionDiagnostics(fileName);
                return checkDiagnostics(fileName, priorDiagnostics, ts.DiagnosticCategory.Suggestion);
            };

            // Override semantic diagnostics
            proxy.getSemanticDiagnostics = (fileName: string) => {
                const priorDiagnostics = oldGetSemanticDiagnostics(fileName);
                return checkDiagnostics(fileName, priorDiagnostics, ts.DiagnosticCategory.Warning);
            };

            return proxy;
        }
    };
};

module.exports = init;
