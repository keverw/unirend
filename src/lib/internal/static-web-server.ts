////////
// * Take single map import
// * Handle 404 and 500 pages, default or they can provide their own files named that????
// * I guess similar configure could build something to do the same with PHP???? But out of scope? Hmm
// hmm wonder if should have a have a demo around this using 'SIGHUP', etc.

import { APIServer } from './api-server';

// todo: temped to make isDevelopment not a option, and always false but idk yet
interface StaticWebServerOptions {
  isDevelopment: boolean;
}

export class StaticWebServer {
  private server: APIServer;

  constructor(options: StaticWebServerOptions) {
    this.server = new APIServer({
      isDevelopment: options.isDevelopment,
      plugins: [
        // todo: need to pass the static content one with the map????
      ],
      // Split error handlers for 500 errors, with web only defined
      // errorHandler: {
      // web: () => {},
      // },
      // Split not found handlers for 404 errors, with web only defined
      // notFoundHandler: {
      // web: () => {},
      // },
    });
  }
}
