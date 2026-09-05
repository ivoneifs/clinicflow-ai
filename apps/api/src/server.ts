import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { env } from './config/env.js';
import { registerRoutes } from './routes.js';
import './workers/whatsappWorker.js';
import { ZodError } from 'zod';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(sensible);
await registerRoutes(app);
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (error instanceof ZodError) return reply.code(400).send({ error: 'Dados inválidos.', issues: error.issues });
  const statusCode = typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : 'Erro interno do servidor.';
  return reply.code(statusCode).send({ error: message });
});
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
