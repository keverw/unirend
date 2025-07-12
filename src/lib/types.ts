export type renderType = "ssg" | "ssr";
export interface IRenderRequest {
  type: renderType;
}

export interface IRenderResult {
  html: string;
}