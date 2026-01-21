// Empty shim for server-only modules
export default {};
export const createServer = () => {};
export const Router = function() { return { get: () => {}, post: () => {}, use: () => {} }; };
export const open = () => Promise.resolve({});
export const Level = class {};
