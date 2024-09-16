module.exports = {
    preset: "ts-jest",
    transform: {
        "^.+\\.(ts|tsx|jsx|js)$": [
            "ts-jest",
            {
                tsConfig: "tsconfig.json",
                isolatedModules: true
            }
        ]
    },
    testRegex: "/.*\\.test.(ts|tsx|jsx|js)$",
    moduleDirectories: ["node_modules", "bower_components", "shared"]
};
