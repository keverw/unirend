import { unirendBaseRender } from '../../src/server';
import type { RenderRequest } from '../../src/server';
import { routes } from './Routes';

export async function render(request: RenderRequest) {
  return unirendBaseRender(request, routes);
}
