// What the frontend asks the backend, by name: what it reads (with its place in the
// cache), the Previews of unsaved changes, and the changes themselves. Each goes
// through the typed client, so a path, parameter or body the backend doesn't take
// fails to compile. Split by concept; import from here.
export * from './changes'
export * from './customers'
export * from './lists'
export * from './mortgages'
export * from './outreach'
export * from './overview'
export * from './payments'
export * from './previews'
export * from './settings'
