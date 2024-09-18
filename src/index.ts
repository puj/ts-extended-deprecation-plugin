import * as ts from "typescript";
import { getCommentsFromDeclaration, isDeclarationDeprecated, isNodeDeprecated, isSupportedFileType } from "./utils";
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
    program: ts.Program,
    optionalSymbolToMatch?: ts.Symbol
) => {
    const diagnostics: Diagnostic[] = [];

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
                        return [];
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
                                let exportSymbol = exports.find(s => s.name === importName);

                                if (!exportSymbol) {
                                    const allExports = moduleSymbol.exports;

                                    const wildcardExports = [];
                                    allExports.forEach(exportEntry => {
                                        log(`[IMPORT] Export Entry: ${exportEntry.getName()}`);

                                        // Check if the import is a wildcard import
                                        log(`[IMPORT] Checking optional symbol: ${optionalSymbolToMatch?.getName()}`);

                                        // Filter to all exports where name == "__export"
                                        if (exportEntry.getName() === "__export") {
                                            wildcardExports.push(exportEntry);
                                        }
                                    });

                                    log(`[IMPORT] Found ${wildcardExports.length} wildcard exports`);
                                    wildcardExports.forEach(wildcardExport => {
                                        const exportSymbolDeclaration = wildcardExport.declarations?.[0];
                                        log(
                                            `[IMPORT] Checking wildcard export declaration: ${exportSymbolDeclaration?.getText()}`
                                        );

                                        log(
                                            `[IMPORT] Wildcard module specifier: ${exportSymbolDeclaration.moduleSpecifier.getText()}`
                                        );

                                        const resolvedWildcardModule = ts.resolveModuleName(
                                            exportSymbolDeclaration.moduleSpecifier.text,
                                            sourceFile.fileName,
                                            program.getCompilerOptions(),
                                            ts.sys
                                        );
                                        log(
                                            `[IMPORT] Resolved wildcard module: ${resolvedWildcardModule.resolvedModule}`
                                        );

                                        const resolvedWildcardFileName =
                                            resolvedWildcardModule.resolvedModule.resolvedFileName;
                                        log(
                                            `[IMPORT] Resolved module "${exportSymbolDeclaration.moduleSpecifier.getText()}" to "${resolvedWildcardFileName}"`
                                        );

                                        const wildcardModuleSourceFile =
                                            program.getSourceFile(resolvedWildcardFileName);

                                        // Get the module symbol from the source file
                                        const wildcardModuleSymbol =
                                            checker.getSymbolAtLocation(wildcardModuleSourceFile);

                                        const wildcardModuleExports = checker.getExportsOfModule(wildcardModuleSymbol);
                                        log(
                                            `[IMPORT] Wildcard exports: ${wildcardModuleExports
                                                .map(e => e.getName())
                                                .join(", ")}`
                                        );

                                        /**
                                         * If optionalSymbolToMatch is provided we assume to know the symbol name we are looking for.
                                         * If using importName as the symbol name, we will check if the wildcard module exports contain the symbol name.
                                         */
                                        const importNameToMatch = optionalSymbolToMatch?.getName() || importName;
                                        const hasTargetExport = wildcardModuleExports.find(
                                            e => e.getName() === importNameToMatch
                                        );

                                        if (hasTargetExport) {
                                            exportSymbol = wildcardExport;
                                        }
                                    });
                                } else {
                                    // If the export symbol name doesn't match the current symbol, skip
                                    if (
                                        optionalSymbolToMatch &&
                                        exportSymbol?.getName() !== optionalSymbolToMatch.getName()
                                    ) {
                                        log(
                                            `[IMPORT] Skipping export "${importName} - ${exportSymbol?.getName()} - ${optionalSymbolToMatch.getName()}"`
                                        );
                                        continue;
                                    }
                                }

                                const exportSymbolDeclaration = exportSymbol?.getDeclarations()?.[0];

                                /**
                                 * Check if the parent node of the export symbol is deprecated.
                                 */
                                let exportSymbolParent = exportSymbolDeclaration?.parent;
                                log(`[IMPORT] Checking parent node for deprecation: ${exportSymbolParent?.getText()}`);
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

                                        diagnostics.push(
                                            createDeprecatedDiagnostic(
                                                importNode,
                                                exportSymbol,
                                                exportSymbolDeclaration.getSourceFile(),
                                                [],
                                                log,
                                                exportSymbolDeclaration
                                            )
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

                                            // Recursively search node for importSpecifier matching imoprtname
                                            const searchNodeForImportSpecifier = (node: ts.Node) => {
                                                if (ts.isImportSpecifier(node) && node.name.text === importName) {
                                                    return node;
                                                }
                                                return ts.forEachChild(node, searchNodeForImportSpecifier);
                                            };
                                            let importNode = searchNodeForImportSpecifier(node);

                                            log(`[IMPORT] Import Node: ${importNode?.getText()}`);

                                            diagnostics.push(
                                                createDeprecatedDiagnostic(
                                                    importNode,
                                                    exportSymbol,
                                                    node.getSourceFile(),
                                                    [],
                                                    log,
                                                    declaration
                                                )
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
        return diagnostics;
    }
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
                // if (info.project && info.project.projectService && info.project.projectService.logger) {
                //     info.project.projectService.logger.info(`[DEPRECATION PLUGIN]: ${message}`);
                // } else {
                //     console.log(`[DEPRECATION PLUGIN]: ${message}`);
                // }
            };

            log("Plugin Initialized - hotloading");

            const checker: ts.TypeChecker | undefined = info.languageService.getProgram()?.getTypeChecker();

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
                        const deprecatedAliasDiagnostics = isImportDeclarationDeprecated(node, checker, log, program);
                        if (deprecatedAliasDiagnostics?.length) {
                            for (const diagnostic of deprecatedAliasDiagnostics) {
                                diagnostic.category = category;
                                diagnostics.push(diagnostic);
                            }
                            return;
                        } else if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
                            // This will check for deprecated symbols in the source file by checkin the import declarations using the same logic as above
                            const symbol = checker.getSymbolAtLocation(node);

                            if (symbol) {
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

                                        const deprecatedAliasDiagnostics = isImportDeclarationDeprecated(
                                            importDeclaration,
                                            checker,
                                            log,
                                            program,
                                            symbol
                                        );
                                        if (deprecatedAliasDiagnostics?.length) {
                                            for (const diagnostic of deprecatedAliasDiagnostics) {
                                                diagnostic.start = node.getStart();
                                                diagnostic.length = node.getEnd() - node.getStart();
                                                diagnostics.push(diagnostic);
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
