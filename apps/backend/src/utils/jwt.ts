// import jwt from 'jsonwebtoken';

// const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
// const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export type JwtPayload = { userId: string; role: string };

// export const signAccessToken = (payload: JwtPayload) =>
//   jwt.sign(payload, ACCESS_SECRET, { expiresIn: '1d' }) as string;

// export const signRefreshToken = (payload: JwtPayload) =>
//   jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' }) as string;

// export const verifyAccessToken = (token: string) =>
//   jwt.verify(token, ACCESS_SECRET) as JwtPayload;

// export const verifyRefreshToken = (token: string) =>
//   jwt.verify(token, REFRESH_SECRET) as JwtPayload;
