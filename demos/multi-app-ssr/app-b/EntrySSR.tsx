import { unirendBaseRender } from '../../../src/server';
import type { RenderRequest } from '../../../src/server';

import { routes } from './Routes';

export async function render(renderRequest: RenderRequest) {
  return await unirendBaseRender(renderRequest, routes, { strictMode: true });
}
