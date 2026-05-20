import type { CookieSerializeOptions } from '@fastify/cookie';

const isProduction = process.env.NODE_ENV === 'production';

export const REFRESH_TOKEN_COOKIE: CookieSerializeOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/authorized/auth/refresh',
};

export const CLEAR_REFRESH_TOKEN_COOKIE: CookieSerializeOptions = {
  ...REFRESH_TOKEN_COOKIE,
  maxAge: 0,
};

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
