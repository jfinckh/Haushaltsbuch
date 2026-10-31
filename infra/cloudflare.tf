# The Cloudflare side: one tunnel from the server, two addresses, and who may use them.
#
#   <app_subdomain>.<domain>  →  tunnel  →  http://127.0.0.1:3000  (people, after the email login)
#   <ssh_subdomain>.<domain>  →  tunnel  →  ssh://127.0.0.1:22     (only GitHub's service token)

locals {
  app_host = "${var.app_subdomain}.${var.domain}"
  ssh_host = "${var.ssh_subdomain}.${var.domain}"
}

data "cloudflare_zone" "main" {
  filter = {
    name = var.domain
  }
}

# --- Tunnel ------------------------------------------------------------------------------------

resource "cloudflare_zero_trust_tunnel_cloudflared" "app" {
  account_id = var.cloudflare_account_id
  name       = "haushaltsbuch"
  config_src = "cloudflare" # routes below are managed here, not on the server
}

# The token cloudflared on the server uses to connect (handed over through cloud-init).
data "cloudflare_zero_trust_tunnel_cloudflared_token" "app" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.app.id
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "app" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.app.id

  config = {
    ingress = [
      { hostname = local.app_host, service = "http://127.0.0.1:3000" },
      { hostname = local.ssh_host, service = "ssh://127.0.0.1:22" },
      { service = "http_status:404" }, # anything else
    ]
  }
}

resource "cloudflare_dns_record" "app" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = local.app_host
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.app.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "ssh" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = local.ssh_host
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.app.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

# --- Access: the app ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_policy" "people" {
  account_id = var.cloudflare_account_id
  name       = "Haushaltsbuch: allowed people"
  decision   = "allow"
  include    = [for email in var.allowed_emails : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  account_id       = var.cloudflare_account_id
  name             = "Haushaltsbuch"
  type             = "self_hosted"
  domain           = local.app_host
  session_duration = var.access_session_duration

  policies = [{ id = cloudflare_zero_trust_access_policy.people.id, precedence = 1 }]
}

# Home-screen app: browsers load the manifest without cookies, so the login above would block it.
# Only the manifest and the icons skip the login; they show the app name and icon, no data.
# A path-specific application wins over the one for the whole host.
resource "cloudflare_zero_trust_access_policy" "pwa_files" {
  account_id = var.cloudflare_account_id
  name       = "Haushaltsbuch: app name and icons, no login"
  decision   = "bypass"
  include    = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "pwa_files" {
  account_id = var.cloudflare_account_id
  name       = "Haushaltsbuch: app name and icons"
  type       = "self_hosted"
  destinations = [
    { type = "public", uri = "${local.app_host}/manifest.webmanifest" },
    { type = "public", uri = "${local.app_host}/icons/*" },
  ]

  policies = [{ id = cloudflare_zero_trust_access_policy.pwa_files.id, precedence = 1 }]
}

# --- Access: SSH for the deploy job ------------------------------------------------------------

resource "cloudflare_zero_trust_access_service_token" "deploy" {
  account_id = var.cloudflare_account_id
  name       = "haushaltsbuch-github-deploy"
  duration   = "87600h" # 10 years; replace with `tofu apply -replace=...` to rotate (README)
}

resource "cloudflare_zero_trust_access_policy" "deploy" {
  account_id = var.cloudflare_account_id
  name       = "Haushaltsbuch: GitHub deploy"
  decision   = "non_identity" # a machine, no person signs in
  include    = [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.deploy.id } }]
}

resource "cloudflare_zero_trust_access_application" "ssh" {
  account_id       = var.cloudflare_account_id
  name             = "Haushaltsbuch SSH"
  type             = "self_hosted"
  domain           = local.ssh_host
  session_duration = "1h"

  # GitHub with its service token, and the allowed people (README "Open a shell on the server").
  # Both still need the deploy SSH key; Access is only the first lock.
  policies = [
    { id = cloudflare_zero_trust_access_policy.deploy.id, precedence = 1 },
    { id = cloudflare_zero_trust_access_policy.people.id, precedence = 2 },
  ]
}

# --- R2: delete old backups --------------------------------------------------------------------

resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = var.backup_bucket

  rules = [{
    id         = "delete-old-backups"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = var.backup_retention_days * 86400 }
    }
  }]
}
