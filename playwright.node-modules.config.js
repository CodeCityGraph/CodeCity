const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './node_modules/cytoscape/tests-examples',
  testIgnore: [],
  testMatch: /.*\.spec\.js$/,
});