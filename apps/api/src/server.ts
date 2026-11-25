import { loadEnv } from './infra/config/env.js';
import { buildApp } from './infra/http/app.js';

async function start() {
  const env = loadEnv();
  const app = await buildApp({ env });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
