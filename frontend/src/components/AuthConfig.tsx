import React from "react";
import type { AuthConfig, AuthType } from "../types/auth";

type Props = {
  value: AuthConfig;
  onChange: (next: AuthConfig) => void;
};

export function AuthConfigEditor({ value, onChange }: Props) {
  const type: AuthType = value.type;

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Authentication</div>
        <select
          className="border rounded-md px-2 py-1"
          value={type}
          onChange={(e) => {
            const nextType = e.target.value as AuthType;
            if (nextType === "none") onChange({ type: "none" });
            if (nextType === "bearer") onChange({ type: "bearer", bearerToken: "" });
            if (nextType === "oauth2_client_credentials")
              onChange({
                type: "oauth2_client_credentials",
                oauth2: { tokenUrl: "", clientId: "", clientSecret: "" },
              });
          }}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer Token</option>
          <option value="oauth2_client_credentials">OAuth2 Client Credentials</option>
        </select>
      </div>

      {type === "bearer" && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Bearer Token</label>
          <input
            className="w-full border rounded-md px-3 py-2"
            value={(value as any).bearerToken ?? ""}
            onChange={(e) => onChange({ type: "bearer", bearerToken: e.target.value })}
            placeholder="eyJhbGciOi..."
          />
          <p className="text-xs opacity-70">
            Sent as <code>Authorization: Bearer &lt;token&gt;</code>
          </p>
        </div>
      )}

      {type === "oauth2_client_credentials" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium">Token URL</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={(value as any).oauth2?.tokenUrl ?? ""}
                onChange={(e) =>
                  onChange({
                    type: "oauth2_client_credentials",
                    oauth2: { ...(value as any).oauth2, tokenUrl: e.target.value },
                  })
                }
                placeholder="https://auth.example.com/oauth/token"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Client ID</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={(value as any).oauth2?.clientId ?? ""}
                onChange={(e) =>
                  onChange({
                    type: "oauth2_client_credentials",
                    oauth2: { ...(value as any).oauth2, clientId: e.target.value },
                  })
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Client Secret</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                type="password"
                value={(value as any).oauth2?.clientSecret ?? ""}
                onChange={(e) =>
                  onChange({
                    type: "oauth2_client_credentials",
                    oauth2: { ...(value as any).oauth2, clientSecret: e.target.value },
                  })
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Scope (optional)</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={(value as any).oauth2?.scope ?? ""}
                onChange={(e) =>
                  onChange({
                    type: "oauth2_client_credentials",
                    oauth2: { ...(value as any).oauth2, scope: e.target.value },
                  })
                }
                placeholder="read:things write:things"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Audience (optional)</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={(value as any).oauth2?.audience ?? ""}
                onChange={(e) =>
                  onChange({
                    type: "oauth2_client_credentials",
                    oauth2: { ...(value as any).oauth2, audience: e.target.value },
                  })
                }
                placeholder="https://api.example.com/"
              />
            </div>
          </div>

          <p className="text-xs opacity-70">
            Backend will exchange client credentials for an access token and send requests with
            <code> Authorization: Bearer &lt;token&gt;</code>.
          </p>
        </div>
      )}
    </div>
  );
}
