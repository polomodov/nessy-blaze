declare module "electron-playwright-helpers" {
  export function stubDialog(
    electronApp: unknown,
    methodName: string,
    payload: unknown,
  ): Promise<void>;

  export function findLatestBuild(): string;

  export function parseElectronApp(buildPath: string): {
    main: string;
    executable: string;
    resourcesPath?: string;
  };
}
