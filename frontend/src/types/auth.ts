export type AuthType = "none" | "bearer" | "oauth2_client_credentials";

export type OAuth2ClientCredentials = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
};

export type AuthConfig =
  | { type: "none" }
  | { type: "bearer"; bearerToken: string }
  | { type: "oauth2_client_credentials"; oauth2: OAuth2ClientCredentials };
