import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

let blitzConfigs = [];
let tsExtensionRules = [];

try {
  const blitzPlugin = (await import('@blitz/eslint-plugin')).default;
  const { jsFileExtensions } = await import('@blitz/eslint-plugin/dist/configs/javascript.js');
  const { getNamingConventionRule, tsFileExtensions } = await import(
    '@blitz/eslint-plugin/dist/configs/typescript.js'
  );

  blitzConfigs = [
    ...blitzPlugin.configs.recommended(),
    {
      rules: {
        '@blitz/catch-error-name': 'off',
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/no-empty-object-type': 'off',
      },
    },
    {
      files: ['**/*.tsx'],
      rules: {
        ...getNamingConventionRule({}, true),
      },
    },
    {
      files: ['**/*.d.ts'],
      rules: {
        '@typescript-eslint/no-empty-object-type': 'off',
      },
    },
    {
      files: [...tsFileExtensions, ...jsFileExtensions, '**/*.tsx'],
      ignores: ['functions/*'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['../'],
                message: `Relative imports are not allowed. Please use '~/'.`,
              },
            ],
          },
        ],
      },
    },
  ];
} catch {
  // Optional @blitz/eslint-plugin not installed in runtime environment
}

export default [
  {
    ignores: ['**/dist', '**/node_modules', '**/.wrangler', '**/bolt/build'],
  },
  ...blitzConfigs,
  ...tsExtensionRules,
  firebaseRulesPlugin.configs['flat/recommended'],
];
