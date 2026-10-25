# Deployment behind Cloudflare Access (not set up yet)

Nothing here exists yet. This page describes how the app is meant to run on a server: hidden
behind Cloudflare Access, reachable only through a Cloudflare Tunnel, with the login done by
Cloudflare. The app itself only checks the signed token Cloudflare adds to every request
(README, "Auth module").

```
Browser ──HTTPS──▶ Cloudflare Access (login, policy) ──Tunnel──▶ cloudflared ──▶ app:3000 ──▶ Postgres
                                                                (same Docker network, no open port)
```

## What it costs

- Cloudflare Zero Trust: free plan, up to 50 users (check the current terms on Cloudflare's pricing page).
- A domain whose DNS is at Cloudflare (about 10 € a year).
- The server (e.g. Hetzner).

## 1. Cloudflare account

1. Add the domain to Cloudflare (DNS at Cloudflare).
2. Open **Zero Trust**, choose a team name (gives `https://<team>.cloudflareaccess.com`) and the free plan.
3. **Settings → Authentication → Login methods:** "One-time PIN" (a code by email, nothing else needed)
   or Google / GitHub. Two-factor login comes from that method.

## 2. Access application

1. **Access → Applications → Add → Self-hosted.**
2. Domain: `haushalt.<domain>`. Session duration e.g. 1 month (the PWA stays signed in).
3. Policy "Allow" with **Include → Emails**: the two (or more) people. Nobody else gets past this page,
   so it is the list of who may use the app. The app creates a user on their first visit.
4. After saving, copy the **Application Audience (AUD) tag** from the application's overview.

## 3. Tunnel

1. **Networks → Tunnels → Create a tunnel → Cloudflared**, copy the tunnel token.
2. Public hostname: `haushalt.<domain>` → service `http://app:3000`.
3. On the server, `cloudflared` runs next to the app in the same Docker Compose project. The app's
   port is **not** published, so the only way in is through the tunnel:

```yaml
# Added to docker-compose.yml on the server (sketch; the app image does not exist yet)
services:
  app:
    image: haushaltsbuch:latest      # built from the repository; no `ports:`
    env_file: .env.production
    depends_on: [postgres]
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on: [app]
    restart: unless-stopped
```

4. Hetzner firewall: no inbound traffic except SSH (or SSH also through Cloudflare, then nothing at all).
   Postgres keeps no published port on the server either.

## 4. App settings on the server

```
AUTH_MODE=identity
BETTER_AUTH_URL=https://haushalt.<domain>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
IDENTITY_ISSUER=https://<team>.cloudflareaccess.com
IDENTITY_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
IDENTITY_AUDIENCE=<AUD tag from step 2>
# optional, these are the defaults:
# IDENTITY_JWT_HEADER=Cf-Access-Jwt-Assertion
# IDENTITY_LOGOUT_URL=/cdn-cgi/access/logout
```

`AUTH_MODE=dev` would not start here: the dev sign-in needs `next dev` and a localhost address.
Leaving `AUTH_MODE` out means `identity` as well.

## 5. Check

- Open `https://haushalt.<domain>` in a private window: Cloudflare's login page comes first.
- Sign in with an allowed email: the app opens, the user exists.
- Another email: Cloudflare refuses, the app never sees the request.
- Sign out in the app: you land on Cloudflare's "logged out" page.

## Privacy

Cloudflare ends TLS and passes every request on, so it can see the traffic. The concept asks for a
data processing agreement (AVV) with every provider: accept Cloudflare's DPA in the dashboard. The
field encryption in the app (IBANs, names, references) still protects database dumps and backups.

## Another provider

The app only needs a signed token in a header. For a self-hosted Pomerium, set its values:
`IDENTITY_JWT_HEADER=X-Pomerium-Jwt-Assertion`, `IDENTITY_ISSUER` / `IDENTITY_AUDIENCE` as Pomerium
signs them, `IDENTITY_JWKS_URL=https://<authenticate host>/.well-known/pomerium/jwks.json`, and its
logout address in `IDENTITY_LOGOUT_URL`.
