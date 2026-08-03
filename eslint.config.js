const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // Carga de datos asíncrona dentro de effects: la regla dispara
      // falsos positivos en fetchs asíncronos habituales en React Native.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
