declare global {
  namespace Auth {
    interface UserPayload {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      accessToken?: string;
    }
  }
}

export {};
