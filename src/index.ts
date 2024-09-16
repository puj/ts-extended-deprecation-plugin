import * as ts from "typescript";
import {
    findNodeAtPosition,
    getSymbolAtNode,
    isDeclaractionDeprecated,
    isSupportedFileType,
    isSymbolDeprecated
} from "./utils";
import { Diagnostic } from "typescript";

// Common function to create diagnostic for deprecated symbols
const createDeprecatedDiagnostic = (
    node: ts.Node,
    symbol: ts.Symbol,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    priorDiagnostics: Diagnostic[],
    log: (message: string) => void
): Diagnostic | null => {
    const diagnosticStart = node.getStart();
    const diagnosticEnd = node.getEnd() - node.getStart();
    const diagnosticCode = 6385; // Deprecated code

    const declaration = symbol.getDeclarations()[0];
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
    // Handle Import Declarations
    if (ts.isImportDeclaration(node)) {
        const importClause = node.importClause;
        log(`Checking import clause: ${importClause?.getText()}`);

        if (importClause && importClause.namedBindings) {
            const namedBindings = importClause.namedBindings;
            if (ts.isNamedImports(namedBindings)) {
                for (const element of namedBindings.elements) {
                    log(`Checking import element: ${element.name.text}`);
                    const symbol = checker.getSymbolAtLocation(element.name);
                    if (symbol) {
                        // Check the alias chain for deprecations
                        if (isSymbolDeprecatedRecursively(symbol, checker, log)) {
                            return createDeprecatedDiagnostic(node, symbol, checker, node.getSourceFile(), [], log);
                        }
                    }
                }
            }
        }
    }

    // Handle Re-export Declarations
    if (ts.isExportDeclaration(node)) {
        log(`Checking export declaration: ${node.getText()}`);
        const exportClause = node.exportClause;

        if (exportClause && ts.isNamedExports(exportClause)) {
            // Check if the export clause itself is deprecated
            const exportDeclarationSymbol = exportClause.parent;
            if (isDeclaractionDeprecated(exportDeclarationSymbol)) {
                log(`Export declaration ${exportDeclarationSymbol.getText()} is deprecated`);
            }

            // Handle named exports like `export { X } from "module"`
            for (const element of exportClause.elements) {
                log(`Checking export element: ${element.name.text}`);
                const symbol = checker.getSymbolAtLocation(element.name);
                if (symbol) {
                    // Check the alias chain for deprecations
                    if (isSymbolDeprecatedRecursively(symbol, checker, log)) {
                        return createDeprecatedDiagnostic(node, symbol, checker, node.getSourceFile(), [], log);
                    }
                }
            }
        } else if (node.moduleSpecifier) {
            // Handle `export * from "module"` (wildcard re-exports)
            const moduleSymbol = checker.getSymbolAtLocation(node.moduleSpecifier);
            if (moduleSymbol) {
                const exports = checker.getExportsOfModule(moduleSymbol);
                exports.forEach(exp => {
                    log(`Checking re-exported symbol: ${exp.getName()}`);
                    if (isSymbolDeprecatedRecursively(exp, checker, log)) {
                        log(`Re-exported symbol ${exp.getName()} is deprecated`);
                    }
                });
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
            log(`Symbol ${currentSymbol.getName()} is not an alias.`);
            break;
        }

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
                console.log(`[DEPRECATION PLUGIN]: ${message}`);
                // Or use the logger if available
                if (info.project && info.project.projectService && info.project.projectService.logger) {
                    info.project.projectService.logger.info(`[DEPRECATION PLUGIN]: ${message}`);
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
                                checker,
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
