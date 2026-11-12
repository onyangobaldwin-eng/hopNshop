/// <reference types="vite/client" />

// Ionic React 8.8.19 ships its runtime wrapper without a resolvable declaration
// entry in this installation. Keep the app buildable while the dependency is
// pinned; component props remain checked by React at runtime.
declare module '@ionic/react' {
  import type { ComponentType, HTMLAttributes, ReactNode } from 'react';
  export const IonApp: ComponentType<HTMLAttributes<HTMLElement> & { children?: ReactNode }>;
  export const IonContent: ComponentType<HTMLAttributes<HTMLElement> & { fullscreen?: boolean; children?: ReactNode }>;
  export const IonPage: ComponentType<HTMLAttributes<HTMLElement> & { children?: ReactNode }>;
  export const IonIcon: ComponentType<HTMLAttributes<HTMLElement> & { icon: string }>; 
  export function setupIonicReact(options?: { mode?: string }): void;
}
