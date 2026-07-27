export const env = {
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN!,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES!,
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES!,
  // Base URL of the FastAPI data-connector service (server-side only).
  PYTHON_API_URL: process.env.PYTHON_API_URL ?? 'http://localhost:8000',
  // 32-byte key (base64 or hex) for AES-256-GCM Data Source secret encryption.
  DATASOURCE_ENCRYPTION_KEY: process.env.DATASOURCE_ENCRYPTION_KEY!,
};
