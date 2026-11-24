import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { loadConfig } from './config/app-config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, '0.0.0.0');
new Logger('Bootstrap').log(`API listening on http://localhost:${config.port}/api/v1`);
