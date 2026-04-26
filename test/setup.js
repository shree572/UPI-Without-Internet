// Jest setup file
console.log('Setting up test environment...');

// Set test environment variables
process.env.NODE_ENV = 'test';

// Increase timeout for async operations
jest.setTimeout(10000);
