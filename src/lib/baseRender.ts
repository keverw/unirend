import { IRenderRequest, IRenderResult } from "./types";
import { type ReactNode } from "react";
import {
  createStaticRouter,
  createStaticHandler,
  type RouteObject,
} from "react-router";
import { wrapStaticRouter } from "./internal/wrapAppElement";

  renderRequest: IRenderRequest,
  element: ReactNode,
): IRenderResult {
  // todo: implement
}
 