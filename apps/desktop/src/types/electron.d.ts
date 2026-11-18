declare module "electron" {
  export interface App {
    readonly isPackaged: boolean;
    requestSingleInstanceLock(): boolean;
    getPath(name: "userData" | "home" | "appData" | "temp"): string;
    getVersion(): string;
    whenReady(): Promise<void>;
    quit(): void;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }

  export interface WebPreferences {
    preload?: string;
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
    sandbox?: boolean;
    devTools?: boolean;
    spellcheck?: boolean;
  }

  export interface BrowserWindowOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
    backgroundColor?: string;
    show?: boolean;
    autoHideMenuBar?: boolean;
    webPreferences?: WebPreferences;
  }

  export interface WebContents {
    on(event: string, listener: (...args: any[]) => void): this;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "allow" | "deny" }): void;
  }

  export class BrowserWindow {
    readonly webContents: WebContents;
    constructor(options?: BrowserWindowOptions);
    loadURL(url: string): Promise<void>;
    show(): void;
    hide(): void;
    focus(): void;
    isMinimized(): boolean;
    restore(): void;
    isDestroyed(): boolean;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }

  export interface MenuItemConstructorOptions {
    label?: string;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
    enabled?: boolean;
    click?: () => void;
  }

  export class Menu {
    static buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  }

  export interface NativeImage {
    isEmpty(): boolean;
    resize(options: { width: number; height: number }): NativeImage;
  }

  export const nativeImage: {
    createFromDataURL(dataURL: string): NativeImage;
    createFromPath(path: string): NativeImage;
    createEmpty(): NativeImage;
  };

  export class Tray {
    constructor(image: NativeImage | string);
    setToolTip(toolTip: string): void;
    setContextMenu(menu: Menu | null): void;
    on(event: string, listener: (...args: any[]) => void): this;
    destroy(): void;
  }

  export const ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    openPath(fullPath: string): Promise<string>;
  };

  export const app: App;
}
