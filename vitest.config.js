// vitest configuration (CommonJS to avoid needing 'vitest/config' resolution)
module.exports = {
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    globals: false,
  },
};