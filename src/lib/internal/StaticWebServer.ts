import { APIServer } from './APIServer';

interface StaticWebServerOptions {
  isDevelopment: boolean;
}

export class StaticWebServer {
  private server: APIServer;

  constructor(options: StaticWebServerOptions) {
    this.server = new APIServer({
      isDevelopment: options.isDevelopment,
    });
  }
}
