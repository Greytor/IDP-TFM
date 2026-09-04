/// <reference types="vite/client" />

/* Submódulos de swagger-ui-dist que @types/swagger-ui-dist no declara.
   Solo se tipa lo que la vista Apis usa de verdad. */
declare module 'swagger-ui-dist/swagger-ui-bundle' {
  export interface SwaggerRequest {
    headers: Record<string, string>;
    url: string;
    [k: string]: unknown;
  }
  export interface SwaggerUIOptions {
    domNode?: HTMLElement | null;
    urls?: { url: string; name: string }[];
    presets?: unknown[];
    layout?: string;
    requestInterceptor?: (req: SwaggerRequest) => SwaggerRequest;
    [k: string]: unknown;
  }
  interface SwaggerUIBundleFn {
    (opts: SwaggerUIOptions): unknown;
    presets: { apis: unknown };
  }
  const SwaggerUIBundle: SwaggerUIBundleFn;
  export default SwaggerUIBundle;
}

declare module 'swagger-ui-dist/swagger-ui-standalone-preset' {
  const SwaggerUIStandalonePreset: unknown;
  export default SwaggerUIStandalonePreset;
}
