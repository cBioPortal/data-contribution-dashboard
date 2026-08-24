/** Jest runs the backend's native ESM directly — no Babel transform needed.
 *  Requires NODE_OPTIONS=--experimental-vm-modules (set in the npm scripts). */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
};
