import * as ts from "typescript";
import {
    findNodeAtPosition,
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
const isImportExportDeclarationDeprecated = (
    node: ts.Node,
    checker: ts.TypeChecker,
    log: (message: string) => void
) => {
    const symbol = getSymbolAtNode(checker, node);

    // Handle Import Declarations
    if (ts.isImportDeclaration(node)) {
        const importClause = node.importClause;
        if (importClause && importClause.namedBindings) {
            const namedBindings = importClause.namedBindings;
            if (ts.isNamedImports(namedBindings)) {
                // <----- This is where we see "TempUtils"
                const moduleSpecifier = node.moduleSpecifier;
                log(`[IMPORT] Checking module specifier: ${moduleSpecifier.getText()}`);
                const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
                log(`[IMPORT] Found module symbol: ${moduleSymbol?.getName()}`);

                // How do we actually get to the file for "TempUtils"?
                // How do we scan the exports of "TempUtils"?
                log(`[IMPORT] Checking import clause: ${importClause.getText()}`);

                const isModuleSymbolAnAlias = moduleSymbol?.flags & ts.SymbolFlags.Alias;
                if (isModuleSymbolAnAlias) {
                    const aliasedModuleSymbol = checker.getAliasedSymbol(moduleSymbol);
                    log(`[IMPORT] Module symbol is an alias. Checking alias: ${aliasedModuleSymbol?.getName()}`);
                    if (isSymbolDeprecatedRecursively(aliasedModuleSymbol, checker, log)) {
                        return createDeprecatedDiagnostic(node, aliasedModuleSymbol, node.getSourceFile(), [], log);
                    }
                }

                if (moduleSymbol) {
                    const exports = checker.getExportsOfModule(moduleSymbol);
                    log(`[IMPORT] Found ${exports.length} exports in module.`);
                    for (const element of namedBindings.elements) {
                        log(`[IMPORT] Checking import element: ${element.name.text}`);
                        const name = element.name.text;
                        const exportSymbol = exports.find(s => s.name === name);
                        const exportSymbolDeclaration = exportSymbol?.getDeclarations()?.[0];

                        /**
                         * Check if the parent node of the export symbol is deprecated.
                         */
                        let exportSymbolParent = exportSymbolDeclaration?.parent;
                        while (exportSymbolParent && !ts.isSourceFile(exportSymbolParent)) {
                            const isExportSymbolParentDeprecated = isNodeDeprecated(checker, exportSymbolParent);
                            log(`[IMPORT] Parent node is deprecated: ${isExportSymbolParentDeprecated}`);
                            if (isExportSymbolParentDeprecated) {
                                return createDeprecatedDiagnostic(
                                    node,
                                    exportSymbol,
                                    exportSymbolDeclaration.getSourceFile(),
                                    [],
                                    log,
                                    exportSymbolDeclaration
                                );
                            }
                            exportSymbolParent = exportSymbolParent?.parent;
                        }

                        if (isDeclarationDeprecated(exportSymbolDeclaration)) {
                            log(`[IMPORT] Import declaration ${exportSymbol.name} is deprecated`);
                            return createDeprecatedDiagnostic(
                                node,
                                getSymbolAtNode(checker, node),
                                node.getSourceFile(),
                                [],
                                log,
                                exportSymbolDeclaration
                            );
                        }

                        if (exportSymbol) {
                            log(`[IMPORT] Checking imported symbol: ${exportSymbol.getName()}`);
                            if (isSymbolDeprecatedRecursively(exportSymbol, checker, log)) {
                                return createDeprecatedDiagnostic(
                                    node,
                                    getSymbolAtNode(checker, node),
                                    node.getSourceFile(),
                                    [],
                                    log,
                                    exportSymbolDeclaration
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    // Handle Export Declarations
    if (ts.isExportDeclaration(node)) {
        log(`[EXPORT] Checking export declaration: ${node.getText()}`);
        const exportClause = node.exportClause;

        if (exportClause && ts.isNamedExports(exportClause)) {
            const moduleSpecifier = node.moduleSpecifier;
            let exportedSymbols: ts.Symbol[] = [];

            if (moduleSpecifier) {
                // Re-exporting from another module
                log(`[EXPORT] Module specifier found: ${moduleSpecifier.getText()}`);
                const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
                if (moduleSymbol) {
                    exportedSymbols = checker.getExportsOfModule(moduleSymbol);
                    log(`[EXPORT] Found ${exportedSymbols.length} exports in module.`);
                }
            }

            // Handle named exports like `export { X }` or `export { X } from "module"`
            for (const element of exportClause.elements) {
                const exportName = element.name.text;
                log(`[EXPORT] Checking export element: ${exportName}`);

                let exportSymbol: ts.Symbol | undefined;

                if (moduleSpecifier && exportedSymbols.length > 0) {
                    // If re-exporting from a module, find the symbol in the module's exports
                    exportSymbol = exportedSymbols.find(s => s.name === exportName);
                } else {
                    // Otherwise, get the symbol from the local scope
                    exportSymbol = checker.getSymbolAtLocation(element.name);
                }

                if (exportSymbol) {
                    const exportDeclaration = exportSymbol.getDeclarations()?.[0];

                    // Check parent nodes for deprecation
                    let parentNode = exportDeclaration?.parent;
                    while (parentNode && !ts.isSourceFile(parentNode)) {
                        const isParentDeprecated = isNodeDeprecated(checker, parentNode);
                        log(`[EXPORT] Parent node is deprecated: ${isParentDeprecated}`);
                        if (isParentDeprecated) {
                            return createDeprecatedDiagnostic(
                                node,
                                exportSymbol,
                                node.getSourceFile(),
                                [],
                                log,
                                exportDeclaration
                            );
                        }
                        parentNode = parentNode.parent;
                    }

                    // Check if the export declaration itself is deprecated
                    if (isDeclarationDeprecated(exportDeclaration)) {
                        log(`[EXPORT] Export declaration ${exportSymbol.getName()} is deprecated`);
                        return createDeprecatedDiagnostic(
                            exportDeclaration,
                            exportSymbol,
                            node.getSourceFile(),
                            [],
                            log,
                            exportDeclaration
                        );
                    }

                    // Check if the symbol is deprecated recursively
                    if (isSymbolDeprecatedRecursively(exportSymbol, checker, log)) {
                        log(`[EXPORT] Exported symbol ${exportSymbol.getName()} is deprecated recursively`);
                        return createDeprecatedDiagnostic(node, exportSymbol, node.getSourceFile(), [], log);
                    }
                } else {
                    log(`[EXPORT] Could not find symbol for export element: ${exportName}`);
                }
            }
        } else if (node.moduleSpecifier) {
            // Handle `export * from "module"` (wildcard re-exports)
            const moduleSpecifier = node.moduleSpecifier;
            log(`[EXPORT] Checking module specifier: ${moduleSpecifier.getText()}`);
            const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
            if (moduleSymbol) {
                const exportedSymbols = checker.getExportsOfModule(moduleSymbol);
                log(`[EXPORT] Found ${exportedSymbols.length} exports in module.`);
                for (const exportSymbol of exportedSymbols) {
                    log(`[EXPORT] Checking re-exported symbol: ${exportSymbol.getName()}`);
                    const exportDeclaration = exportSymbol.getDeclarations()?.[0];

                    // Check parent nodes for deprecation
                    let parentNode = exportDeclaration?.parent;
                    while (parentNode && !ts.isSourceFile(parentNode)) {
                        const isParentDeprecated = isNodeDeprecated(checker, parentNode);
                        log(`[EXPORT] Parent node is deprecated: ${isParentDeprecated}`);
                        if (isParentDeprecated) {
                            log(`[EXPORT] Re-exported symbol's parent node is deprecated`);
                            return createDeprecatedDiagnostic(
                                node,
                                symbol,
                                node.getSourceFile(),
                                [],
                                log,
                                exportDeclaration
                            );
                        }
                        parentNode = parentNode.parent;
                    }

                    // Check if the export declaration itself is deprecated
                    if (isDeclarationDeprecated(exportDeclaration)) {
                        log(`[EXPORT] Re-exported symbol ${exportSymbol.getName()} is deprecated`);
                        return createDeprecatedDiagnostic(
                            node,
                            symbol,
                            node.getSourceFile(),
                            [],
                            log,
                            exportDeclaration
                        );
                    }

                    // Check if the symbol is deprecated recursively
                    if (isSymbolDeprecatedRecursively(exportSymbol, checker, log)) {
                        log(`[EXPORT] Re-exported symbol ${exportSymbol.getName()} is deprecated recursively`);
                        return createDeprecatedDiagnostic(node, exportSymbol, node.getSourceFile(), [], log);
                    }
                }
            }
        }
    }
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
            proxy.getQuickInfoAtPosition = (fileName: string, position: number) => {
                if (!isSupportedFileType(fileName)) return oldGetQuickInfoAtPosition(fileName, position);

                const quickInfo: ts.QuickInfo = oldGetQuickInfoAtPosition(fileName, position);
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const node = findNodeAtPosition(sourceFile, position);

                if (node && checker) {
                    const symbol = checker.getSymbolAtLocation(node);
                    if (symbol && isSymbolDeprecatedRecursively(symbol, checker, log)) {
                        log(`Deprecated symbol detected: ${symbol.getName()}`);

                        // Create detailed deprecation message with source information
                        const deprecationTag = createDeprecatedQuickInfoTag(symbol, checker);
                        if (deprecationTag) {
                            quickInfo.tags = quickInfo.tags || [];
                            quickInfo.tags.push(deprecationTag);
                        }
                    }
                }

                return quickInfo;
            };

            // Common logic for both suggestion and semantic diagnostics
            const checkDiagnostics = (
                fileName: string,
                priorDiagnostics: Diagnostic[],
                category: ts.DiagnosticCategory
            ) => {
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const diagnostics: Diagnostic[] = [];

                if (sourceFile && checker && isSupportedFileType(fileName)) {
                    log(`Checking ${fileName} for deprecated symbols`);

                    const visit = (node: ts.Node) => {
                        // Use the re-export resolution logic for imports and exports
                        const deprecatedAliasDiagnostic = isImportExportDeclarationDeprecated(node, checker, log);
                        if (deprecatedAliasDiagnostic) {
                            deprecatedAliasDiagnostic.category = category;
                            diagnostics.push(deprecatedAliasDiagnostic);
                            return;
                        }

                        // If the alias chain is not deprecated, check the symbol directly
                        const symbol = getSymbolAtNode(checker, node);
                        if (symbol && isSymbolDeprecatedRecursively(symbol, checker, log)) {
                            const diagnostic = createDeprecatedDiagnostic(
                                node,
                                symbol,
                                sourceFile,
                                priorDiagnostics,
                                log
                            );
                            if (diagnostic) {
                                diagnostic.category = category;
                                diagnostics.push(diagnostic);
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
