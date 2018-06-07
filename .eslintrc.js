module.exports = {
    "extends": "airbnb-base",
    "plugins": [
        "import"
    ],
    "rules": {
        "linebreak-style": 0,
        "no-console": 0,
        "no-use-before-define": ["error", "nofunc"],
        "indent": ["error", 4, { "SwitchCase": 1 }],
        "arrow-parens": [2, "as-needed", { "requireForBlockBody": true }],
        "no-plusplus": 0,
        "no-underscore-dangle": ["error", { "allowAfterThis": true, "allowAfterSuper": true }],
        "max-len": ["error", {
            "code": 150,
            "ignoreStrings": true,
            "ignoreTemplateLiterals": true,
            "ignoreComments": true,
        }],
        "no-unused-vars": ["error", { "varsIgnorePattern": "[iI]gnored", "argsIgnorePattern": "^_" }],
        "no-param-reassign": 0,
        "no-return-await": 0,
        "no-continue": 0,
        "radix": ["error", "as-needed"],
        "no-bitwise": 0,
        "comma-dangle": ["error", "always-multiline", {"functions": "ignore"}]
    },
};
