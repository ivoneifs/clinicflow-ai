import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';

const scrypt = promisify(scryptCallback);
const tokenTtlSeconds = 8 * 60 * 60;
const tokenSecret = () => process.env.MASTER_ADMIN_TOKEN_SECRET || process.env.MASTER_ADMIN_PASSWORD || 'clinicflow-local-auth-secret';
const safeEqual = (a: string, b: string) => { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };

export const userPasswordSchema = z.string().min(12, 'A senha deve ter pelo menos 12 caracteres.');
export const hashUserPassword = async (password: string) => { const salt = randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64) as Buffer; return `scrypt:${salt}:${derived.toString('hex')}`; };
export const verifyUserPassword = async (password: string, encoded: string) => { const [, salt, digest] = encoded.split(':'); if (!salt || !digest) return false; const derived = await scrypt(password, salt, 64) as Buffer; return safeEqual(derived.toString('hex'), digest); };

export function createUserToken(user: { id: string; clinicId: string; role: string; email: string }) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, clinicId: user.clinicId, role: user.role, email: user.email, exp: Math.floor(Date.now() / 1000) + tokenTtlSeconds })).toString('base64url');
  const signature = createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readUserToken(value: unknown) {
  if (typeof value !== 'string') return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try { const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; clinicId?: string; role?: string; email?: string; exp?: number }; return decoded.sub && decoded.clinicId && decoded.role && decoded.exp && decoded.exp > Math.floor(Date.now() / 1000) ? decoded : null; } catch { return null; }
}

export async function registerAuthRoutes(app: any) {
  app.post('/api/v1/auth/login', async (request: any, reply: any) => {
    const body = z.object({ email: z.string().email(), password: userPasswordSchema, clinicId: z.string().optional() }).parse(request.body);
    const user = await prisma.user.findFirst({ where: { email: { equals: body.email.trim().toLowerCase(), mode: 'insensitive' }, active: true, ...(body.clinicId ? { clinicId: body.clinicId } : {}) }, include: { clinic: { select: { id: true, name: true, slug: true } } } });
    if (!user || !(await verifyUserPassword(body.password, user.passwordHash))) return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    return { token: createUserToken(user), expiresIn: tokenTtlSeconds, user: { id: user.id, name: user.name, email: user.email, role: user.role, specialty: user.specialty, clinic: user.clinic } };
  });
  app.get('/api/v1/auth/me', async (request: any, reply: any) => {
    const authorization = String(request.headers.authorization || '');
    const decoded = readUserToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined);
    if (!decoded) return reply.code(401).send({ error: 'Sessão inválida ou expirada.' });
    const user = await prisma.user.findFirst({ where: { id: decoded.sub, active: true }, select: { id: true, name: true, email: true, role: true, specialty: true, clinicId: true, clinic: { select: { id: true, name: true, slug: true } } } });
    if (!user) return reply.code(401).send({ error: 'Usuário não encontrado ou inativo.' });
    return { user };
  });
}
