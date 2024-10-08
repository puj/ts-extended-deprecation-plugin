import * as ts from "typescript";
import {
    getCommentsFromDeclaration,
    getSymbolAtNode,
    isDeclarationDeprecated,
    isNodeDeprecated,
    isSupportedFileType
} from "./utils";
import { Diagnostic } from "typescript";

const areDiagnosticEqual = (a: Diagnostic, b: Diagnostic) => {
    return (
        a.start === b.start &&
        a.length === b.length &&
        a.code === b.code &&
        a.category === b.category &&
        a.file === b.file
    );
};

const getUniqueDiagnostics = (priorDiagnostics: Diagnostic[], diagnostics: Diagnostic[]) => {
    const uniqueDiagnostics: Diagnostic[] = [];

    // Add prior diagnostics
    priorDiagnostics.forEach(priorDiagnostic => {
        const isUnique = !diagnostics.some(diagnostic => areDiagnosticEqual(diagnostic, priorDiagnostic));

        if (isUnique) {
            uniqueDiagnostics.push(priorDiagnostic);
        }
    });

    // Add new diagnostics
    diagnostics.forEach(diagnostic => {
        const isUnique = !uniqueDiagnostics.some(uniqueDiagnostic => areDiagnosticEqual(uniqueDiagnostic, diagnostic));

        if (isUnique) {
            uniqueDiagnostics.push(diagnostic);
        }
    });

    return uniqueDiagnostics;
};

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
    symbolName: string,
    symbol: ts.Symbol,
    sourceFile: ts.SourceFile,
    priorDiagnostics: Diagnostic[],
    log: (message: string) => void,
    declarationOverride?: ts.NamedDeclaration
): Diagnostic | null => {
    log(`Creating diagnostic for deprecated symbol: ${symbolName} - ${node.getText()}`);

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
        log(`Adding diagnostic for deprecated symbol: ${symbolName}`);
        return {
            file: sourceFile,
            start: diagnosticStart,
            length: diagnosticEnd,
            messageText: `'${symbolName}' is deprecated.`,
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

type ImportCacheResultType = {
    importDeclaration: ts.ImportDeclaration;
    symbol: ts.Symbol;
    diagnostics: Diagnostic[];
    isDeprecated: boolean;
};

const importNodeCache = new Map<string, ts.Node | null>();
const exportSymbolCache = new Map<ts.Symbol, Diagnostic>();
const wildCardExportDeclarationsCache = new Map<ts.Symbol, ts.Declaration[]>();
const wildCardExportDeclarationCache = new Map<string, ts.Declaration>();
const wildCardExportSymbolCache = new Map<string, ts.Symbol | null>();
const importCache = new Map<string, ImportCacheResultType>();

const getWildcardExportSymbolCacheKey = (moduleSymbol: ts.Symbol, importName: string) => {
    return moduleSymbol.getName() + "-" + importName;
};

const getWildcardExportDeclarationFor = (moduleSymbol: ts.Symbol, importName: string) => {
    const key = getWildcardExportSymbolCacheKey(moduleSymbol, importName);
    return wildCardExportDeclarationCache.get(key);
};

const getCachedWildcardExportSymbolFor = (moduleSymbol: ts.Symbol, importName: string) => {
    const key = getWildcardExportSymbolCacheKey(moduleSymbol, importName);
    return wildCardExportSymbolCache.get(key);
};

const setCachedWildcardExportDeclarationFor = (
    moduleSymbol: ts.Symbol,
    importName: string,
    exportDeclaration: ts.Declaration
) => {
    const key = getWildcardExportSymbolCacheKey(moduleSymbol, importName);
    wildCardExportDeclarationCache.set(key, exportDeclaration);
};

const setCachedWildcardExportSymbolFor = (
    moduleSymbol: ts.Symbol,
    importName: string,
    exportSymbol: ts.Symbol | null
) => {
    const key = getWildcardExportSymbolCacheKey(moduleSymbol, importName);
    wildCardExportSymbolCache.set(key, exportSymbol);
};

const getImportNodeCacheKey = (importDeclaration: ts.ImportDeclaration, importName: string) => {
    return importDeclaration.getSourceFile().fileName + "-" + importDeclaration.getText() + "-" + importName;
};

const getCachedImportNodeFor = (importDeclaration: ts.Node, importName: string) => {
    const key = getImportNodeCacheKey(importDeclaration as ts.ImportDeclaration, importName);
    return importNodeCache.get(key);
};

const setCachedImportNodeFor = (importDeclaration: ts.Node, importName: string, importNode: ts.Node | null) => {
    const key = getImportNodeCacheKey(importDeclaration as ts.ImportDeclaration, importName);
    importNodeCache.set(key, importNode);
};

const getImportCacheKey = (importDeclaration: ts.ImportDeclaration, targetSymbol: ts.Symbol) => {
    return (
        importDeclaration.getSourceFile().fileName + "-" + importDeclaration.getText() + "-" + targetSymbol.getName()
    );
};

const getCachedDiagnosticForImportDeclaration = (importDeclaration: ts.ImportDeclaration, targetSymbol: ts.Symbol) => {
    const cacheKey = getImportCacheKey(importDeclaration, targetSymbol);
    return importCache.get(cacheKey);
};

const addCachedDiagnosticForImportDeclaration = (
    importDeclaration: ts.ImportDeclaration,
    targetSymbol: ts.Symbol,
    diagnostic: Diagnostic[]
) => {
    const cacheKey = getImportCacheKey(importDeclaration, targetSymbol);

    const existingCache = importCache.get(cacheKey);
    if (existingCache) {
        existingCache.diagnostics = existingCache.diagnostics.concat(diagnostic);
        existingCache.isDeprecated = true;
        importCache.set(cacheKey, existingCache);
    } else {
        importCache.set(cacheKey, {
            importDeclaration,
            symbol: targetSymbol,
            diagnostics: diagnostic,
            isDeprecated: true
        });
    }
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
                                const elementSymbol = checker.getSymbolAtLocation(element.name);
                                const cachedImportResult = getCachedDiagnosticForImportDeclaration(node, elementSymbol);
                                // if (cachedImportResult) {
                                //     log(`[IMPORT] Found cached import result for symbol: ${elementSymbol.getName()}`);
                                //     return cachedImportResult.diagnostics;
                                // }

                                let exportSymbol = exports.find(s => s.name === importName);
                                let exportSymbolDeclaration = exportSymbol?.getDeclarations()?.[0];
                                const importNameToMatch = optionalSymbolToMatch?.getName() || importName;

                                // if (exportSymbol && exportSymbolCache.has(exportSymbol)) {
                                //     log(`[IMPORT] Found cached export symbol: ${exportSymbol.getName()}`);
                                //     const exportSymbolDiagnostic = exportSymbolCache.get(exportSymbol);
                                //     if (exportSymbolDiagnostic) {
                                //         exportSymbolDiagnostic.start = currentNode.getStart();
                                //         exportSymbolDiagnostic.length = currentNode.getEnd() - currentNode.getStart();

                                //         diagnostics.push(exportSymbolDiagnostic);
                                //         addCachedDiagnosticForImportDeclaration(node, exportSymbol, [
                                //             exportSymbolDiagnostic
                                //         ]);
                                //     }
                                //     continue;
                                // }

                                if (!exportSymbol) {
                                    log(
                                        `[IMPORT] Could not find export "${importName}" in module "${moduleName}", checking wildcard exports`
                                    );
                                    // exportSymbol = getCachedWildcardExportSymbolFor(moduleSymbol, importNameToMatch);
                                    // log(`[IMPORT] Found cached wildcard export: ${exportSymbol?.getName()}`);
                                    if (exportSymbol === undefined) {
                                        log(`[IMPORT] Could not find cached wildcard export for "${importName}"`);
                                        // setCachedWildcardExportSymbolFor(moduleSymbol, importNameToMatch, null);
                                        let wildcardExportDeclarations: ts.Declaration[] =
                                            wildCardExportDeclarationsCache.get(moduleSymbol);

                                        log(`[IMPORT] Checking ${wildcardExportDeclarations?.length} wildcard exports`);

                                        if (!wildcardExportDeclarations) {
                                            wildcardExportDeclarations = [];
                                            const allExports = moduleSymbol.exports;
                                            allExports.forEach(exportEntry => {
                                                log(`[IMPORT] Export Entry: ${exportEntry.getName()}`);

                                                // Check if the import is a wildcard import
                                                log(
                                                    `[IMPORT] Checking optional symbol: ${optionalSymbolToMatch?.getName()}`
                                                );

                                                // Filter to all exports where name == "__export"
                                                if (exportEntry.getName() === "__export") {
                                                    // Print all declarations

                                                    exportEntry.getDeclarations()?.forEach(declaration => {
                                                        log(
                                                            `[IMPORT] Wildcard Export Declaration: ${declaration.getText()}`
                                                        );

                                                        wildcardExportDeclarations.push(declaration);
                                                    });
                                                }
                                            });
                                            wildCardExportDeclarationsCache.set(
                                                moduleSymbol,
                                                wildcardExportDeclarations
                                            );
                                        }

                                        log(`[IMPORT] Found ${wildcardExportDeclarations.length} wildcard exports`);
                                        wildcardExportDeclarations.forEach(wildcardExport => {
                                            const wildcardExportSymbolDeclaration =
                                                wildcardExport as ts.ExportDeclaration;
                                            log(
                                                `[IMPORT] Checking wildcard export declaration: ${wildcardExportSymbolDeclaration?.getText()}`
                                            );

                                            log(
                                                `[IMPORT] Wildcard module specifier: ${wildcardExportSymbolDeclaration.moduleSpecifier.getText()}`
                                            );

                                            let resolvedWildcardModule = ts.resolveModuleName(
                                                (wildcardExportSymbolDeclaration.moduleSpecifier as any).text,
                                                moduleSourceFile.fileName,
                                                program.getCompilerOptions(),
                                                ts.sys
                                            );
                                            if (!resolvedWildcardModule.resolvedModule) {
                                                resolvedWildcardModule = ts.resolveModuleName(
                                                    wildcardExportSymbolDeclaration.moduleSpecifier.getText(),
                                                    moduleSourceFile.fileName,
                                                    program.getCompilerOptions(),
                                                    ts.sys
                                                );
                                            }
                                            if (!resolvedWildcardModule.resolvedModule) {
                                                resolvedWildcardModule = ts.resolveModuleName(
                                                    moduleSourceFile.fileName,
                                                    moduleSourceFile.fileName,
                                                    program.getCompilerOptions(),
                                                    ts.sys
                                                );
                                            }

                                            log(
                                                `[IMPORT] Resolved wildcard module: ${resolvedWildcardModule.resolvedModule}`
                                            );

                                            if (resolvedWildcardModule.resolvedModule) {
                                                const resolvedWildcardFileName =
                                                    resolvedWildcardModule.resolvedModule.resolvedFileName;
                                                log(
                                                    `[IMPORT] Resolved module "${wildcardExportSymbolDeclaration.moduleSpecifier.getText()}" to "${resolvedWildcardFileName}"`
                                                );

                                                const wildcardModuleSourceFile =
                                                    program.getSourceFile(resolvedWildcardFileName);

                                                // Get the module symbol from the source file
                                                const wildcardModuleSymbol =
                                                    checker.getSymbolAtLocation(wildcardModuleSourceFile);

                                                const wildcardModuleExports =
                                                    checker.getExportsOfModule(wildcardModuleSymbol);
                                                log(
                                                    `[IMPORT] Wildcard exports: ${wildcardModuleExports
                                                        .map(e => e.getName())
                                                        .join(", ")}`
                                                );

                                                /**
                                                 * If optionalSymbolToMatch is provided we assume to know the symbol name we are looking for.
                                                 * If using importName as the symbol name, we will check if the wildcard module exports contain the symbol name.
                                                 */
                                                const hasTargetExport = wildcardModuleExports.find(
                                                    e => e.getName() === importNameToMatch
                                                );

                                                if (hasTargetExport) {
                                                    exportSymbol = getSymbolAtNode(checker, wildcardExport.parent);
                                                    exportSymbolDeclaration = wildcardExport;
                                                    log(
                                                        `[IMPORT] Found wildcard export: ${importNameToMatch}-${wildcardExport?.getText()}, caching symbol: ${exportSymbol?.getName()}`
                                                    );
                                                    // setCachedWildcardExportSymbolFor(
                                                    //     moduleSymbol,
                                                    //     importNameToMatch,
                                                    //     exportSymbol
                                                    // );
                                                }
                                            }
                                        });
                                    }
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
                                        let importNode = getCachedImportNodeFor(node, importName);
                                        if (importNode === undefined) {
                                            setCachedImportNodeFor(node, importName, null);
                                            node.forEachChild(child => {
                                                log(`[IMPORT] Child: ${child.getText()}`);
                                                child.forEachChild(namedImport => {
                                                    log(`[IMPORT] Named Import: ${namedImport.getText()}`);
                                                    namedImport.forEachChild(importSpec => {
                                                        log(`[IMPORT] Import Specifier: ${importSpec.getText()}`);
                                                        if (importSpec.getText() === importName) {
                                                            importNode = importSpec;
                                                            setCachedImportNodeFor(node, importName, importNode);
                                                        }
                                                    });
                                                });
                                            });
                                        } else {
                                            log(`[IMPORT] Found cached import node: ${importNode?.getText()}`);
                                        }

                                        const diagnostic = createDeprecatedDiagnostic(
                                            importNode,
                                            optionalSymbolToMatch?.getName() || importName,
                                            exportSymbol,
                                            exportSymbolDeclaration.getSourceFile(),
                                            [],
                                            log,
                                            exportSymbolDeclaration
                                        );
                                        diagnostics.push(diagnostic);
                                        addCachedDiagnosticForImportDeclaration(node, exportSymbol, [diagnostic]);

                                        exportSymbolCache.set(exportSymbol, diagnostic);
                                    }
                                    exportSymbolParent = exportSymbolParent?.parent;
                                }
                                // At this point the exportSymobol should be populated

                                if (exportSymbol) {
                                    const cachedImportResult = getCachedDiagnosticForImportDeclaration(
                                        node,
                                        exportSymbol
                                    );
                                    // if (cachedImportResult) {
                                    //     log(
                                    //         `[IMPORT] Found cached import result for symbol: ${exportSymbol.getName()}`
                                    //     );
                                    //     return cachedImportResult.diagnostics;
                                    // }

                                    log(
                                        `[IMPORT] Checking export "${importName}" in module "${
                                            moduleSourceFile.getSourceFile().fileName
                                        }"`
                                    );

                                    const declaration = exportSymbolDeclaration || exportSymbol.getDeclarations()?.[0];
                                    if (declaration && !!declaration.parent) {
                                        const declarationComments = getCommentsFromDeclaration(declaration);
                                        if (declarationComments.length > 0) {
                                            log(
                                                `[IMPORT] Found comments on declaration:  ${declarationComments.join(
                                                    "\n"
                                                )} \n${declaration.getText()}`
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
                                            let importNode = getCachedImportNodeFor(node, importName);
                                            if (importNode === undefined) {
                                                importNode = searchNodeForImportSpecifier(node);
                                                setCachedImportNodeFor(node, importName, importNode);
                                            }

                                            log(`[IMPORT] Import Node: ${importNode?.getText()}`);

                                            const diagnostic = createDeprecatedDiagnostic(
                                                importNode,
                                                optionalSymbolToMatch?.getName() || importName,
                                                exportSymbol,
                                                node.getSourceFile(),
                                                [],
                                                log,
                                                declaration
                                            );
                                            diagnostics.push(diagnostic);
                                            addCachedDiagnosticForImportDeclaration(node, exportSymbol, [diagnostic]);
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
        log(`[IMPORT] Returning diagnostics: ${diagnostics.length}`);
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

                // Reset caches
                importNodeCache.clear();
                exportSymbolCache.clear();
                wildCardExportDeclarationsCache.clear();
                wildCardExportDeclarationCache.clear();
                wildCardExportSymbolCache.clear();
                importCache.clear();

                if (sourceFile && checker && isSupportedFileType(fileName)) {
                    log(`Checking ${fileName} for deprecated symbols`);

                    const visit = (node: ts.Node) => {
                        // If not leaf node, skip
                        if (node.getChildCount() > 0 && !ts.isImportDeclaration(node)) {
                            ts.forEachChild(node, visit);
                            return;
                        }

                        // Check if node start/end/category/source file is already in diagnostics
                        diagnostics.some(diagnostic => {
                            if (
                                diagnostic.start === node.getStart() &&
                                diagnostic.length === node.getEnd() - node.getStart() &&
                                diagnostic.category === category &&
                                diagnostic.file === sourceFile
                            ) {
                                return true;
                            }
                        });

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

                                        // const cachedImportResult = getCachedDiagnosticForImportDeclaration(
                                        //     importDeclaration as ts.ImportDeclaration,
                                        //     symbol
                                        // );
                                        const cachedImportResult = undefined;

                                        if (cachedImportResult) {
                                            log(
                                                `Cached import for symbol: ${symbol.getName()}, found ${
                                                    cachedImportResult.diagnostics.length
                                                } diagnostics`
                                            );
                                            if (cachedImportResult.diagnostics?.length) {
                                                for (const diagnostic of cachedImportResult.diagnostics) {
                                                    diagnostic.start = node.getStart();
                                                    diagnostic.length = node.getEnd() - node.getStart();
                                                    diagnostics.push(diagnostic);
                                                }
                                            }
                                        } else {
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
                        }

                        ts.forEachChild(node, visit);
                    };

                    visit(sourceFile);
                }

                return getUniqueDiagnostics(priorDiagnostics, diagnostics);
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
