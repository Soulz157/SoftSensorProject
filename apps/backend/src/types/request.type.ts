import { FastifyRequest } from 'fastify';

export type AuthenticatedRequest = FastifyRequest & {
  user: Auth.UserPayload;
};
