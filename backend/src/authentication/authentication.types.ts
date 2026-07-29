export type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

export type AuthenticatedUser = {
  id: string;
  fullName: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
};

export type LoginResult = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthenticatedUser;
};
