declare module '@unicitylabs/sphere-sdk/impl/browser' {
  export function createBrowserProviders(config: any): any;
  export function createIndexedDBStorageProvider(config: any): any;
  export function createLocalStorageProvider(config: any): any;
}

declare module '@unicitylabs/sphere-sdk/impl/shared/wallet-api' {
  export function createWalletApiProviders(base: any, config: any): any;
}
